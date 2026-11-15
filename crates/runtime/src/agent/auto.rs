//! Auto model in the loop: which slot a call gets (phase + purpose), escalation on trouble,
//! and the session spend cap. The router turns a slot into a model (`Catalog::route_auto`).

use super::*;
use silence_protocol::Slot;

/// Fraction of the cap after which Auto stops escalating to Frontier.
pub(super) const BUDGET_SOFT: f64 = 0.8;
/// Consecutive steps with no new result and no successful write before `no_progress`.
const STALL_STEPS: u32 = 4;
/// The same write/edit (same args) this many times in a turn = `no_progress`: re-applying an
/// identical change means the model is going in circles.
const REPEAT_EDITS: u32 = 2;
/// The same non-test shell command this many times = `no_progress`. Reads never count (reading a
/// file again is normal) and neither do test reruns (run → fix → run is the normal loop).
const REPEAT_SHELL: u32 = 3;
/// Errors of one tool in a turn before `repeated_tool_error`.
const TOOL_ERRORS: u32 = 2;

/// What one call runs on, and why.
#[derive(Debug, Clone)]
pub(crate) struct Pick {
    pub model_id: String,
    /// `agent`, `plan`, `title`, `subagent:explore`, … (`Route.task_class`).
    pub purpose: String,
    /// `None` for an explicit model pick.
    pub slot: Option<Slot>,
    pub reason: String,
    pub escalated: bool,
    /// Provider Auto routed within (empty for explicit picks).
    pub source: String,
}

impl Pick {
    pub fn slot_str(&self) -> String {
        self.slot.map(|s| s.as_str().to_string()).unwrap_or_default()
    }

    pub fn route_event(&self) -> SessionEvent {
        SessionEvent::Route {
            task_class: self.purpose.clone(),
            model_id: self.model_id.clone(),
            reason: self.reason.clone(),
            slot: self.slot_str(),
            escalated: self.escalated,
        }
    }
}

/// Side calls that are not the main turn.
#[derive(Debug, Clone, Copy)]
pub(super) enum Aux<'a> {
    Title,
    Subagent(&'a str),
}

pub(super) fn mode_purpose(mode: SessionMode) -> &'static str {
    match mode {
        SessionMode::Agent => "agent",
        SessionMode::Plan => "plan",
        SessionMode::Ask => "ask",
        SessionMode::Debug => "debug",
        SessionMode::Review => "review",
        SessionMode::Multitask => "multitask",
    }
}

/// Session spend vs. the Auto cap of its source: `(spent, cap)`; `cap` is `None` without a cap
/// or on an explicit model pick.
pub(super) fn budget(catalog: &Catalog, s: &Session) -> (f64, Option<f64>) {
    if s.model != "auto" {
        return (s.spent_usd, None);
    }
    let src = catalog.auto_source(&s.source);
    (s.spent_usd, catalog.auto_config(&src).budget_usd)
}

/// Slot of a mode's main turn on `source`: the user's `mode_slots` if set, else the mode default.
pub(super) fn mode_slot(catalog: &Catalog, source: &str, mode: SessionMode) -> Slot {
    let src = catalog.auto_source(source);
    catalog
        .auto_config(&src)
        .mode_slots
        .get(mode_purpose(mode))
        .copied()
        .unwrap_or(profile(mode).slot)
}

/// Model for a main-turn call. Explicit picks win; on Auto the mode gives the slot, the turn's
/// escalation can raise it (not past Strong once the session is near its cap).
pub(super) fn pick_main(catalog: &Catalog, s: &Session, esc: &Escalation, needs_vision: bool) -> Result<Pick> {
    let purpose = mode_purpose(s.mode).to_string();
    if s.model != "auto" && !s.model.is_empty() {
        catalog.resolve(&s.model)?;
        return Ok(Pick {
            model_id: s.model.clone(),
            purpose,
            slot: None,
            reason: "user pick".into(),
            escalated: false,
            source: String::new(),
        });
    }
    let base = mode_slot(catalog, &s.source, s.mode);
    let mut slot = base;
    let mut note = String::new();
    if esc.frontier && base < Slot::Frontier {
        let (spent, cap) = budget(catalog, s);
        if cap.is_some_and(|c| spent >= c * BUDGET_SOFT) {
            note = " · near spend cap, no Frontier".into();
        } else {
            slot = Slot::Frontier;
        }
    }
    let p = catalog.route_auto(&s.source, slot, needs_vision)?;
    let mut reason = format!("mode {purpose} → {} · {}", base.as_str(), p.reason);
    if slot != base || esc.effort_bump {
        reason.push_str(&format!(" · escalated: {}", esc.why));
    }
    reason.push_str(&note);
    Ok(Pick {
        model_id: p.model_id,
        purpose,
        slot: Some(slot),
        reason,
        escalated: esc.frontier || esc.effort_bump,
        source: p.source,
    })
}

/// Model for a side call. These always run over HTTP: on a Claude CLI source they fall back
/// to the HTTP source Auto would use without one.
pub(super) fn pick_aux(catalog: &Catalog, session_model: &str, source: &str, aux: Aux) -> Result<Pick> {
    let (slot, purpose) = match aux {
        Aux::Title => (Slot::Small, "title".to_string()),
        Aux::Subagent("explore") => (Slot::Small, "subagent:explore".to_string()),
        Aux::Subagent("review") => (Slot::Frontier, "subagent:review".to_string()),
        Aux::Subagent(k) => (Slot::Strong, format!("subagent:{k}")),
    };
    // An explicit pick still decides the source; the slot follows that source's Auto settings.
    let src = if session_model != "auto" && !session_model.is_empty() {
        catalog.resolve(session_model).map(|m| m.provider).unwrap_or_default()
    } else {
        catalog.auto_source(source)
    };
    let src = match catalog.provider(&src) {
        Ok(p) if !p.is_cli() => src,
        _ => catalog.auto_source(""),
    };
    let p = catalog.route_auto(&src, slot, false)?;
    Ok(Pick {
        model_id: p.model_id,
        purpose,
        slot: Some(slot),
        reason: p.reason,
        escalated: false,
        source: p.source,
    })
}

/// Title model of a session (Small slot of its source); a session-less call uses Auto's default
/// source.
pub(crate) async fn title_pick(ctx: &AppCtx, session_id: &str) -> Result<Pick> {
    let live = ctx.sessions.lock().await.get(session_id).cloned();
    let (model, source) = match live {
        Some(s) => {
            let s = s.lock().await;
            (s.model.clone(), s.source.clone())
        }
        None => ("auto".to_string(), String::new()),
    };
    pick_aux(&ctx.catalog, &model, &source, Aux::Title)
}

/// Report a side call's cost to the session's event stream and spend (titles).
pub(crate) async fn record_aux_cost(ctx: &AppCtx, session_id: &str, pick: &Pick, r: &gateway::ChatResult, usd: f64) {
    if let Some(s) = ctx.sessions.lock().await.get(session_id).cloned() {
        s.lock().await.spent_usd += usd;
    }
    let tx = ctx.events.lock().await.get(session_id).cloned();
    emit(
        &tx,
        SessionEvent::Cost {
            input_tokens: r.input_tokens,
            output_tokens: r.output_tokens,
            usd,
            slot: pick.slot_str(),
            baseline_usd: baseline_usd(&ctx.catalog, pick, r, usd),
            cache_read_tokens: r.cache_read_tokens,
            cache_write_tokens: r.cache_write_tokens,
        },
    );
}

/// Cost of one call priced on the source's strongest model ("all Opus").
pub(super) fn baseline_usd(catalog: &Catalog, pick: &Pick, r: &gateway::ChatResult, usd: f64) -> f64 {
    if pick.slot.is_none() {
        return usd;
    }
    match catalog.baseline_model(&pick.source) {
        Some(m) if m.input_cost_per_1m > 0.0 || m.output_cost_per_1m > 0.0 => gateway::chat_cost_usd(m, r).max(usd),
        _ => usd,
    }
}

/// One finished tool call, as the loop needs it for escalation.
#[derive(Debug, Clone)]
pub struct ToolOutcome {
    pub name: String,
    /// `name` + args, to spot the same call again.
    pub signature: String,
    pub ok: bool,
    /// The Risk Engine tagged it `BUILD_TEST` (a project build / test command).
    pub test: bool,
    /// A write/edit that changed the workspace (a staged, not yet applied edit does not count).
    pub wrote: bool,
    /// `write`, `edit` or `shell` (`silence_tools::mutates`).
    pub mutating: bool,
}

/// Escalation state of one turn. Stage 1 raises effort one level, stage 2 moves to Frontier,
/// which then holds until the turn ends (keeps the prompt cache).
#[derive(Debug, Default)]
pub(super) struct Escalation {
    pub effort_bump: bool,
    pub frontier: bool,
    pub why: String,
    /// A new step happened since the last Route event.
    pub changed: bool,
    wrote: bool,
    tool_errors: HashMap<String, u32>,
    calls: HashMap<String, u32>,
    stalled: u32,
}

impl Escalation {
    /// A CLI turn cannot switch model mid-turn: a turn that ended in trouble starts the next one
    /// on Frontier.
    pub fn carried(hot: bool) -> Self {
        Self { frontier: hot, why: if hot { "trouble in the last turn".into() } else { String::new() }, ..Default::default() }
    }

    fn bump(&mut self, signal: &str, why: String, rules: &silence_router::Escalation, can_bump_effort: bool) {
        if self.frontier || !rules.enabled(signal) {
            return;
        }
        if !self.effort_bump && can_bump_effort {
            self.effort_bump = true;
        } else {
            self.frontier = true;
        }
        self.why = why;
        self.changed = true;
        // Fresh counters: the next stage needs new evidence.
        self.tool_errors.clear();
        self.calls.clear();
        self.stalled = 0;
    }

    fn jump(&mut self, signal: &str, why: String, rules: &silence_router::Escalation) {
        if self.frontier || !rules.enabled(signal) {
            return;
        }
        self.frontier = true;
        self.why = why;
        self.changed = true;
    }

    /// Feed the tool calls of one step. `debug`: Debug mode goes to Frontier on the first red test.
    pub fn observe_step(
        &mut self,
        outcomes: &[ToolOutcome],
        rules: &silence_router::Escalation,
        debug: bool,
        can_bump_effort: bool,
    ) {
        let mut progress = false;
        for o in outcomes {
            if o.wrote && o.ok {
                self.wrote = true;
                progress = true;
            }
            let n = self.calls.entry(o.signature.clone()).or_default();
            *n += 1;
            let repeat = *n;
            if o.ok && repeat == 1 {
                progress = true;
            }
            if o.test && !o.ok && self.wrote {
                if debug {
                    self.jump("test_fail_after_edit", "tests failed after an edit".into(), rules);
                } else {
                    self.bump("test_fail_after_edit", "tests failed after an edit".into(), rules, can_bump_effort);
                }
                continue;
            }
            if !o.ok {
                let e = self.tool_errors.entry(o.name.clone()).or_default();
                *e += 1;
                if *e >= TOOL_ERRORS {
                    let why = format!("{} failed {} times", o.name, *e);
                    self.bump("repeated_tool_error", why, rules, can_bump_effort);
                    continue;
                }
            }
            let limit = match (o.mutating, o.name.as_str(), o.test) {
                (true, "shell", false) => Some(REPEAT_SHELL),
                (true, "shell", true) => None,
                (true, _, _) => Some(REPEAT_EDITS),
                _ => None,
            };
            if limit.is_some_and(|l| repeat >= l) {
                let why = format!("{} repeated with the same input", o.name);
                self.bump("no_progress", why, rules, can_bump_effort);
            }
        }
        if outcomes.is_empty() {
            return;
        }
        self.stalled = if progress { 0 } else { self.stalled + 1 };
        if self.stalled >= STALL_STEPS {
            self.bump("no_progress", format!("{STALL_STEPS} steps without progress"), rules, can_bump_effort);
        }
    }

    pub fn empty_output(&mut self, rules: &silence_router::Escalation, can_bump_effort: bool) {
        self.bump("empty_output", "empty replies".into(), rules, can_bump_effort);
    }

    pub fn provider_retry(&mut self, rules: &silence_router::Escalation) {
        self.jump("provider_retry", "provider error, retrying stronger".into(), rules);
    }

    /// Ended in trouble: any escalation happened (the CLI carries it to the next turn).
    pub fn hot(&self) -> bool {
        self.effort_bump || self.frontier
    }
}

/// Effort for this call: the session preference mapped to the model, one level up while the
/// turn is on effort escalation. `None` = model has no effort control.
pub(super) fn call_effort(model: &silence_router::ModelEntry, wanted: &str, bump: bool) -> String {
    let base = model.effective_effort(wanted);
    if !bump {
        return base.unwrap_or_else(|| wanted.to_string());
    }
    let Some(base) = base else { return wanted.to_string() };
    let levels = silence_protocol::EFFORT_LEVELS;
    let at = levels.iter().position(|l| *l == base).unwrap_or(0);
    levels[at + 1..]
        .iter()
        .find(|l| model.efforts.iter().any(|e| e == *l))
        .map(|l| l.to_string())
        .unwrap_or(base)
}

/// Can effort still go up on this model?
pub(super) fn effort_can_rise(model: &silence_router::ModelEntry, wanted: &str) -> bool {
    match model.effective_effort(wanted) {
        Some(base) => call_effort(model, wanted, true) != base,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use silence_protocol::AutoConfig;

    fn rules() -> silence_router::Escalation {
        silence_router::Escalation::default()
    }

    fn out(name: &str, sig: &str, ok: bool) -> ToolOutcome {
        let mutating = matches!(name, "write" | "edit" | "shell");
        ToolOutcome { name: name.into(), signature: sig.into(), ok, test: false, wrote: false, mutating }
    }

    fn test_run(ok: bool) -> ToolOutcome {
        ToolOutcome { test: true, ..out("shell", &format!("shell npm test {ok}"), ok) }
    }

    fn edit() -> ToolOutcome {
        ToolOutcome { wrote: true, ..out("edit", "edit a", true) }
    }

    #[test]
    fn red_test_after_edit_raises_effort_then_frontier() {
        let mut e = Escalation::default();
        e.observe_step(&[test_run(false)], &rules(), false, true);
        assert!(!e.hot(), "red test before any edit is just the reproduction");
        e.observe_step(&[edit()], &rules(), false, true);
        e.observe_step(&[test_run(false)], &rules(), false, true);
        assert!(e.effort_bump && !e.frontier);
        e.observe_step(&[ToolOutcome { signature: "edit b".into(), ..edit() }], &rules(), false, true);
        e.observe_step(&[ToolOutcome { signature: "t2".into(), ..test_run(false) }], &rules(), false, true);
        assert!(e.frontier);
        assert!(e.why.contains("tests failed"));
    }

    #[test]
    fn debug_goes_straight_to_frontier_and_no_effort_skips_stage() {
        let mut e = Escalation::default();
        e.observe_step(&[edit(), test_run(false)], &rules(), true, true);
        assert!(e.frontier && !e.effort_bump);
        let mut e = Escalation::default();
        e.observe_step(&[edit(), test_run(false)], &rules(), false, false);
        assert!(e.frontier, "model without effort control: straight to Frontier");
    }

    #[test]
    fn repeated_errors_and_repeats_count() {
        let mut e = Escalation::default();
        e.observe_step(&[out("grep", "g1", false)], &rules(), false, true);
        assert!(!e.hot());
        e.observe_step(&[out("grep", "g2", false)], &rules(), false, true);
        assert!(e.effort_bump);
        let mut e = Escalation::default();
        for _ in 0..5 {
            e.observe_step(&[out("read", "read a.rs", true), out("edit", &format!("e{}", rand_sig(&e)), true)], &rules(), false, true);
        }
        assert!(!e.hot(), "reading the same file again is not trouble");
        let mut e = Escalation::default();
        for _ in 0..4 {
            e.observe_step(&[test_run(true)], &rules(), false, true);
        }
        assert!(!e.hot(), "rerunning tests is the normal loop");
        let mut e = Escalation::default();
        e.observe_step(&[out("edit", "edit same", true)], &rules(), false, true);
        e.observe_step(&[out("edit", "edit same", true)], &rules(), false, true);
        assert!(e.effort_bump, "the same edit twice");
        let mut e = Escalation::default();
        for _ in 0..3 {
            e.observe_step(&[out("shell", "shell ls", true)], &rules(), false, true);
        }
        assert!(e.effort_bump, "the same shell command three times");
    }

    /// Unique per call, so edits in the read test count as progress.
    fn rand_sig(e: &Escalation) -> usize {
        e.calls.len()
    }

    #[test]
    fn stalls_and_disabled_signals() {
        let mut e = Escalation::default();
        e.observe_step(&[out("read", "r1", true)], &rules(), false, true);
        for i in 0..4 {
            e.observe_step(&[out("x", &format!("x{i}"), false), out("read", "r1", true)], &rules(), false, true);
        }
        assert!(e.hot());
        let off = silence_router::Escalation { on: vec!["empty_output".into()] };
        let mut e = Escalation::default();
        e.observe_step(&[edit(), test_run(false)], &off, false, true);
        assert!(!e.hot(), "signal switched off in models.yaml");
        e.empty_output(&off, true);
        assert!(e.effort_bump);
    }

    const CAT: &str = r#"
version: 1
providers:
  - { id: gw, kind: openai_compat, base_url: "http://x" }
  - { id: cli, kind: claude_cli, command: claude }
models:
  - { id: gw-haiku, provider: gw, api_model: h, tier: fast, context_window: 1, output_cost_per_1m: 5 }
  - { id: gw-sonnet, provider: gw, api_model: s, tier: mid, context_window: 1, output_cost_per_1m: 15 }
  - { id: gw-opus, provider: gw, api_model: o, tier: strong, context_window: 1, output_cost_per_1m: 25 }
  - { id: cli-sonnet, provider: cli, api_model: s, tier: mid, context_window: 1 }
  - { id: cli-opus, provider: cli, api_model: o, tier: strong, context_window: 1 }
"#;

    async fn session(mode: SessionMode) -> (Arc<AppCtx>, String, Arc<Mutex<Session>>, tempfile::TempDir, tempfile::TempDir) {
        let data = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let ctx = Arc::new(AppCtx::new(Catalog::from_yaml(CAT).unwrap(), crate::audit::AuditLog::open(data.path()).unwrap()));
        let id = create_session(&ctx, ws.path().to_str().unwrap(), None, mode, PermissionMode::Ask).await.unwrap();
        let s = ctx.sessions.lock().await.get(&id).cloned().unwrap();
        (ctx, id, s, data, ws)
    }

    #[tokio::test]
    async fn mode_gives_slot_and_escalation_raises_it() {
        let (ctx, _id, s, _d, _w) = session(SessionMode::Plan).await;
        let mut sess = s.lock().await;
        let p = pick_main(&ctx.catalog, &sess, &Escalation::default(), false).unwrap();
        assert_eq!((p.model_id.as_str(), p.slot), ("gw-opus", Some(Slot::Frontier)));
        sess.mode = SessionMode::Agent;
        let p = pick_main(&ctx.catalog, &sess, &Escalation::default(), false).unwrap();
        assert_eq!(p.model_id, "gw-sonnet");
        assert_eq!(p.purpose, "agent");
        let hot = Escalation::carried(true);
        let p = pick_main(&ctx.catalog, &sess, &hot, false).unwrap();
        assert_eq!(p.model_id, "gw-opus");
        assert!(p.escalated && p.reason.contains("escalated"));
        // Near the cap: no Frontier.
        ctx.catalog
            .set_auto("gw", AutoConfig { budget_usd: Some(1.0), ..Default::default() })
            .unwrap();
        sess.spent_usd = 0.85;
        let p = pick_main(&ctx.catalog, &sess, &hot, false).unwrap();
        assert_eq!(p.model_id, "gw-sonnet");
        assert!(p.reason.contains("spend cap"));
        sess.spent_usd = 1.0;
        assert!(over_cap(&ctx.catalog, &sess, false, 0.0));
        assert!(!over_cap(&ctx.catalog, &sess, true, 0.0), "one turn allowed past the cap");
        // Below the cap, but the next call (estimated from the last one on the same model) would pass it.
        sess.spent_usd = 0.5;
        sess.last_model = Some("gw-sonnet".into());
        sess.last_call_usd = 0.6;
        let sonnet = ctx.catalog.resolve("gw-sonnet").unwrap();
        assert!(over_cap(&ctx.catalog, &sess, false, next_call_usd(&sess, &sonnet)));
        sess.last_call_usd = 0.1;
        assert!(!over_cap(&ctx.catalog, &sess, false, next_call_usd(&sess, &sonnet)));
        sess.spent_usd = 1.0;
        // An explicit pick ignores Auto entirely.
        sess.model = "gw-haiku".into();
        assert!(!over_cap(&ctx.catalog, &sess, false, 0.0));
        let p = pick_main(&ctx.catalog, &sess, &hot, false).unwrap();
        assert_eq!((p.model_id.as_str(), p.slot), ("gw-haiku", None));
    }

    #[tokio::test]
    async fn cli_source_runs_auto_on_cli_and_keeps_its_conversation() {
        let (ctx, id, s, _d, _w) = session(SessionMode::Agent).await;
        set_model(&ctx, &id, "auto", Some("cli")).await.unwrap();
        {
            let mut sess = s.lock().await;
            match cli_turn_pick(&ctx.catalog, &sess, false).unwrap() {
                CliPick::Run(p) => assert_eq!(p.model_id, "cli-sonnet"),
                _ => panic!("Auto on the CLI source runs on the CLI"),
            }
            sess.cli_hot = true;
            match cli_turn_pick(&ctx.catalog, &sess, false).unwrap() {
                CliPick::Run(p) => assert_eq!(p.model_id, "cli-opus", "trouble last turn → Frontier"),
                _ => panic!(),
            }
            sess.cli_session = Some("c1".into());
        }
        set_model(&ctx, &id, "auto", Some("cli")).await.unwrap();
        assert_eq!(s.lock().await.cli_session.as_deref(), Some("c1"), "same Auto source keeps --resume");
        // Side calls never go to the CLI.
        let t = title_pick(&ctx, &id).await.unwrap();
        assert_eq!((t.model_id.as_str(), t.slot), ("gw-haiku", Some(Slot::Small)));
        set_model(&ctx, &id, "auto", Some("gw")).await.unwrap();
        assert_eq!(s.lock().await.cli_session, None, "leaving the CLI drops its conversation");
        assert!(matches!(cli_turn_pick(&ctx.catalog, &*s.lock().await, false).unwrap(), CliPick::NotCli));
    }

    #[tokio::test]
    async fn spend_survives_new_session_and_resume() {
        let (ctx, id, s, _d, _w) = session(SessionMode::Agent).await;
        carry_spend(&ctx, &id, 0.7).await.unwrap();
        carry_spend(&ctx, &id, 0.2).await.unwrap();
        assert_eq!(s.lock().await.spent_usd, 0.7, "the client can raise the spend, never lower it");
        assert!(carry_spend(&ctx, &id, -1.0).await.is_err());
        // Cost events in the log add up again on resume.
        let tx = ctx.events.lock().await.get(&id).cloned();
        assert!(tx.is_none(), "no subscriber in this test: log the events directly");
        for usd in [0.25, 0.5] {
            ctx.store
                .append(
                    &id,
                    LogBody::Event {
                        event: SessionEvent::Cost { input_tokens: 1, output_tokens: 1, usd, slot: "strong".into(), baseline_usd: usd, cache_read_tokens: 0, cache_write_tokens: 0 },
                    },
                )
                .await
                .unwrap();
        }
        let records = ctx.store.load(&id).unwrap();
        assert!((super::super::resume::logged_spend(&records) - 0.75).abs() < 1e-9);
    }

    #[tokio::test]
    async fn mode_slots_override_the_default() {
        let (ctx, _id, s, _d, _w) = session(SessionMode::Ask).await;
        let mut sess = s.lock().await;
        assert_eq!(pick_main(&ctx.catalog, &sess, &Escalation::default(), false).unwrap().model_id, "gw-sonnet");
        let mut cfg = AutoConfig::default();
        cfg.mode_slots.insert("ask".into(), Slot::Small);
        cfg.mode_slots.insert("agent".into(), Slot::Frontier);
        ctx.catalog.set_auto("gw", cfg).unwrap();
        let p = pick_main(&ctx.catalog, &sess, &Escalation::default(), false).unwrap();
        assert_eq!((p.model_id.as_str(), p.slot), ("gw-haiku", Some(Slot::Small)), "Ask → Small");
        // Escalation still works from a Small start.
        let p = pick_main(&ctx.catalog, &sess, &Escalation::carried(true), false).unwrap();
        assert_eq!(p.model_id, "gw-opus");
        sess.mode = SessionMode::Agent;
        assert_eq!(pick_main(&ctx.catalog, &sess, &Escalation::default(), false).unwrap().model_id, "gw-opus");
        sess.mode = SessionMode::Plan;
        assert_eq!(pick_main(&ctx.catalog, &sess, &Escalation::default(), false).unwrap().model_id, "gw-opus", "unset = default");
        // An explicit pick ignores it.
        sess.model = "gw-sonnet".into();
        sess.mode = SessionMode::Ask;
        assert_eq!(pick_main(&ctx.catalog, &sess, &Escalation::default(), false).unwrap().model_id, "gw-sonnet");
        let mut bad = AutoConfig::default();
        bad.mode_slots.insert("chat".into(), Slot::Small);
        assert!(ctx.catalog.set_auto("gw", bad).is_err());
    }

    #[test]
    fn aux_slots() {
        let c = Catalog::from_yaml(CAT).unwrap();
        let p = |a| pick_aux(&c, "auto", "gw", a).unwrap().model_id;
        assert_eq!(p(Aux::Subagent("explore")), "gw-haiku");
        assert_eq!(p(Aux::Subagent("implement")), "gw-sonnet");
        assert_eq!(p(Aux::Subagent("review")), "gw-opus");
        // Explicit pick: its source's Auto settings decide the side call.
        assert_eq!(pick_aux(&c, "gw-opus", "", Aux::Title).unwrap().model_id, "gw-haiku");
    }

    #[test]
    fn effort_steps_up_within_model_levels() {
        let yaml = r#"
version: 1
providers: [{ id: a, kind: claude_api, base_url: "http://x" }]
models:
  - { id: m, provider: a, api_model: m, tier: mid, context_window: 1, efforts: [low, medium, high], default_effort: medium }
  - { id: n, provider: a, api_model: n, tier: mid, context_window: 1 }
"#;
        let c = Catalog::from_yaml(yaml).unwrap();
        let m = c.model("m").unwrap();
        assert_eq!(call_effort(m, "auto", false), "medium");
        assert_eq!(call_effort(m, "auto", true), "high");
        assert_eq!(call_effort(m, "high", true), "high");
        assert!(effort_can_rise(m, "auto"));
        assert!(!effort_can_rise(m, "high"));
        assert!(!effort_can_rise(c.model("n").unwrap(), "auto"));
    }
}
