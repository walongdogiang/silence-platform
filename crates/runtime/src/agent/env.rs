//! "Runtime environment" block sent with every main call: facts the model cannot know on its own
//! (which model actually runs, how it was chosen, effort, mode, workspace, date, reply language).
//! Facts, not canned answers: the `Runtime facts` rule in `SYSTEM` tells the model to trust it.
//! Built per call because Auto can change model and effort inside a turn. Date only (no time).
//!
//! Prompt cache layout (as in Claude Code's `<system-reminder>`): everything that can change
//! between calls — mode, answer style, this block — travels in one `<turn_context>` user message
//! *after* the history ([`with_turn_context`]); it is never stored. Before it the request is
//! append-only: the static system prompt (base + root instruction files + skill index, see
//! `org.rs`), then the history; skill bodies and nested AGENTS.md arrive in tool results.
//! A new mode, effort or model on the next call therefore re-sends only the small tail instead
//! of invalidating the cached history. The gateway puts the history cache breakpoint on the last
//! message *before* the turn context (`gateway::is_turn_context`).

use super::*;
use crate::gateway::TURN_CONTEXT_TAG;
use silence_router::ModelEntry;

/// What the block reports. Kept apart from `Session`/`Catalog` so it is cheap to test.
pub(super) struct RuntimeEnv<'a> {
    pub model: &'a ModelEntry,
    pub provider_label: String,
    pub pick: &'a Pick,
    /// Effort sent with this call; `None` = the model has no effort control.
    pub effort: Option<&'a str>,
    /// Session preference (`auto` or a level).
    pub effort_pref: &'a str,
    pub mode: SessionMode,
    pub permission: PermissionMode,
    pub workspace: String,
    pub date: String,
    /// Decided by the Engine (`lang::decide`); `None` = the model follows the user's message.
    pub reply_lang: Option<ReplyLang>,
}

impl<'a> RuntimeEnv<'a> {
    pub fn new(
        catalog: &Catalog,
        s: &'a Session,
        model: &'a ModelEntry,
        pick: &'a Pick,
        effort: Option<&'a str>,
    ) -> Self {
        let provider_label = catalog
            .provider_for(model)
            .map(|p| p.display_label())
            .unwrap_or_else(|_| model.provider.clone());
        Self {
            model,
            provider_label,
            pick,
            effort,
            effort_pref: &s.effort,
            mode: s.mode,
            permission: s.permission,
            workspace: s.workspace.root.to_string_lossy().into_owned(),
            date: chrono::Local::now().format("%Y-%m-%d (%A)").to_string(),
            reply_lang: s.reply_lang,
        }
    }

    pub fn render(&self) -> String {
        let m = self.model;
        let name = if m.label.is_empty() { m.id.as_str() } else { m.label.as_str() };
        let choice = match self.pick.slot {
            None => "picked by the user in the model menu".to_string(),
            Some(slot) => {
                let mut c = format!("Auto (5ilence picks per call) — slot `{}`", slot.as_str());
                if self.pick.escalated {
                    c.push_str(", escalated this turn");
                }
                c
            }
        };
        let effort = match self.effort {
            None => "not adjustable on this model".to_string(),
            Some(e) if self.effort_pref == "auto" => format!("{e} (user setting: auto → model default)"),
            Some(e) if e != self.effort_pref && self.pick.escalated => {
                format!("{e} (user setting: {}; adjusted by Auto escalation)", self.effort_pref)
            }
            Some(e) if e != self.effort_pref => {
                format!("{e} (user setting {} is not supported by this model; using its default)", self.effort_pref)
            }
            Some(e) => e.to_string(),
        };
        let permission = serde_json::to_value(self.permission)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default();
        let reply = match self.reply_lang {
            Some(l) => format!(
                "{} — keep it even when tool output, logs or pasted text are in another language",
                l.name()
            ),
            None => "the language of the user's latest message".to_string(),
        };
        format!(
            "## Runtime environment (set by 5ilence for this call)\n\
             - Model: {name} — API model `{api}`, catalog id `{id}`, tier {tier}\n\
             - Provider: {prov} (`{prov_id}`)\n\
             - Model choice: {choice}\n\
             - Effort (reasoning level): {effort}\n\
             - Mode: {mode} · Permission: {permission}\n\
             - Workspace: {ws}\n\
             - OS: {os} · Date: {date}\n\
             - Reply language: {reply}",
            api = m.api_model,
            id = m.id,
            tier = m.tier,
            prov = self.provider_label,
            prov_id = m.provider,
            mode = mode_purpose(self.mode),
            ws = self.workspace,
            os = std::env::consts::OS,
            date = self.date,
        )
    }
}

/// The per-call tail: mode + answer style (`turn_system`) and the runtime block, wrapped so the
/// model can tell it from the user's words. See the module docs for why it comes last.
pub(super) fn turn_context(turn: &str, env: &RuntimeEnv) -> String {
    format!(
        "{TURN_CONTEXT_TAG}\nSet by 5ilence for this call, not written by the user. Follow it; do not \
         answer it, quote it or mention it.\n\n{}\n</turn_context>",
        with_env(turn.to_string(), env)
    )
}

/// History to send: the stored messages unchanged, then the turn context as the last message.
pub(super) fn with_turn_context(messages: &[Value], block: String) -> Vec<Value> {
    let mut out = Vec::with_capacity(messages.len() + 1);
    out.extend_from_slice(messages);
    out.push(json!({"role": "user", "content": block}));
    out
}

/// `turn_system` plus the runtime block, as one text (Claude CLI path: one appended prompt).
pub(super) fn with_env(turn: String, env: &RuntimeEnv) -> String {
    let block = env.render();
    if turn.is_empty() {
        block
    } else {
        format!("{turn}\n\n{block}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use silence_protocol::Slot;

    fn model(efforts: &[&str]) -> ModelEntry {
        serde_json::from_value(json!({
            "id": "claude-haiku",
            "label": "Claude Haiku 5.5",
            "provider": "company-gateway",
            "api_model": "anthropic/claude-haiku-5.5",
            "tier": "fast",
            "context_window": 1000000,
            "efforts": efforts,
            "default_effort": if efforts.is_empty() { "" } else { "medium" },
        }))
        .unwrap()
    }

    fn pick(slot: Option<Slot>, escalated: bool) -> Pick {
        Pick {
            model_id: "claude-haiku".into(),
            purpose: "ask".into(),
            slot,
            reason: String::new(),
            escalated,
            source: String::new(),
        }
    }

    fn env<'a>(m: &'a ModelEntry, p: &'a Pick, effort: Option<&'a str>, pref: &'a str) -> RuntimeEnv<'a> {
        RuntimeEnv {
            model: m,
            provider_label: "OpenRouter".into(),
            pick: p,
            effort,
            effort_pref: pref,
            mode: SessionMode::Ask,
            permission: PermissionMode::Balanced,
            workspace: "D:\\ws".into(),
            date: "2026-11-15 (Sunday)".into(),
            reply_lang: None,
        }
    }

    #[test]
    fn explicit_pick_lists_model_provider_effort() {
        let m = model(&["low", "medium", "high"]);
        let p = pick(None, false);
        let out = env(&m, &p, Some("low"), "low").render();
        assert!(out.starts_with("## Runtime environment"));
        assert!(out.contains("Claude Haiku 5.5"));
        assert!(out.contains("`anthropic/claude-haiku-5.5`"));
        assert!(out.contains("OpenRouter (`company-gateway`)"));
        assert!(out.contains("picked by the user"));
        assert!(out.contains("Effort (reasoning level): low\n"));
        assert!(out.contains("Mode: ask · Permission: balanced"));
        assert!(out.contains("Date: 2026-11-15"));
    }

    #[test]
    fn auto_shows_slot_escalation_and_effort_source() {
        let m = model(&["low", "medium", "high"]);
        let p = pick(Some(Slot::Strong), true);
        let out = env(&m, &p, Some("high"), "medium").render();
        assert!(out.contains("Auto (5ilence picks per call) — slot `strong`, escalated this turn"));
        assert!(out.contains("high (user setting: medium; adjusted by Auto escalation)"));

        let calm = pick(None, false);
        let out = env(&m, &calm, Some("medium"), "max").render();
        assert!(out.contains("medium (user setting max is not supported by this model; using its default)"));

        let out = env(&m, &p, Some("medium"), "auto").render();
        assert!(out.contains("medium (user setting: auto → model default)"));
    }

    #[test]
    fn model_without_effort_control() {
        let m = model(&[]);
        let p = pick(None, false);
        let out = env(&m, &p, None, "auto").render();
        assert!(out.contains("not adjustable on this model"));
    }

    #[test]
    fn with_env_appends_after_mode_and_style() {
        let m = model(&[]);
        let p = pick(None, false);
        let e = env(&m, &p, None, "auto");
        assert!(with_env(String::new(), &e).starts_with("## Runtime environment"));
        assert!(with_env("## Mode: Ask".into(), &e).starts_with("## Mode: Ask\n\n## Runtime environment"));
    }

    #[test]
    fn reply_language_line() {
        let m = model(&[]);
        let p = pick(None, false);
        let mut e = env(&m, &p, None, "auto");
        assert!(e.render().contains("- Reply language: the language of the user's latest message"));
        e.reply_lang = Some(ReplyLang::Vi);
        assert!(e.render().contains("- Reply language: Vietnamese — keep it even when tool output"));
    }

    #[test]
    fn turn_context_comes_after_the_untouched_history() {
        let m = model(&[]);
        let p = pick(None, false);
        let e = env(&m, &p, None, "auto");
        let hist = vec![
            json!({"role": "system", "content": "BASE"}),
            json!({"role": "user", "content": "hi"}),
        ];
        let out = with_turn_context(&hist, turn_context("## Mode: Ask", &e));
        assert_eq!(out.len(), 3);
        // Stored history goes out byte-identical: nothing per call is spliced into it.
        assert_eq!(out[..2], hist[..]);
        assert_eq!(out[2]["role"], "user");
        let tail = out[2]["content"].as_str().unwrap();
        assert!(crate::gateway::is_turn_context(&out[2]));
        assert!(tail.contains("not written by the user"));
        assert!(tail.contains("## Mode: Ask\n\n## Runtime environment"));
        assert!(tail.ends_with("</turn_context>"));
    }

    #[test]
    fn mode_change_keeps_the_prefix() {
        let m = model(&[]);
        let p = pick(None, false);
        let e = env(&m, &p, None, "auto");
        let hist = vec![json!({"role": "system", "content": "BASE"}), json!({"role": "user", "content": "hi"})];
        let ask = with_turn_context(&hist, turn_context("## Mode: Ask", &e));
        let plan = with_turn_context(&hist, turn_context("## Mode: Plan", &e));
        assert_eq!(ask[..2], plan[..2]);
        assert_ne!(ask[2], plan[2]);
    }

    #[test]
    fn system_tells_model_to_trust_the_block() {
        assert!(SYSTEM.contains("## Runtime facts"));
        assert!(SYSTEM.contains("Runtime environment"));
    }
}
