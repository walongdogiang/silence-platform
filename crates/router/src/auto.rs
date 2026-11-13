//! Auto model: picks a model for a slot (Frontier / Strong / Small) within one source.
//!
//! Auto never reads the prompt. The caller maps phase + purpose to a slot (Plan → Frontier,
//! Agent → Strong, titles → Small, …) and escalates the slot on trouble; this module only turns
//! `(source, slot)` into a model of that source, honouring the preset, custom slots and pool.

use crate::{Catalog, ModelEntry};
use anyhow::{anyhow, Result};
use silence_protocol::{AutoConfig, Slot};

/// Mode names `AutoConfig::mode_slots` accepts (`SessionMode` in snake_case).
const MODES: [&str; 6] = ["agent", "plan", "ask", "debug", "review", "multitask"];

/// Order of catalog tiers, weakest first. Unknown tiers sit with `mid`.
pub fn tier_rank(tier: &str) -> i32 {
    match tier {
        "free" => 0,
        "fast" => 1,
        "mid" => 2,
        "strong" => 3,
        _ => 2,
    }
}

/// Catalog tier a preset puts in a slot. `custom` falls back to `balanced` for empty slots.
pub fn preset_tier(preset: &str, slot: Slot) -> &'static str {
    match (preset, slot) {
        ("economy", Slot::Frontier) => "mid",
        ("economy", _) => "fast",
        ("max", Slot::Small) => "fast",
        ("max", _) => "strong",
        (_, Slot::Frontier) => "strong",
        (_, Slot::Strong) => "mid",
        (_, Slot::Small) => "fast",
    }
}

/// What Auto picked for one call.
#[derive(Debug, Clone, PartialEq)]
pub struct AutoPick {
    pub model_id: String,
    pub slot: Slot,
    /// Provider the pick belongs to.
    pub source: String,
    pub reason: String,
}

impl Catalog {
    /// Store the Auto settings of a provider (`auto.set_config`).
    pub fn set_auto(&self, provider: &str, cfg: AutoConfig) -> Result<()> {
        self.provider(provider)?;
        if !matches!(cfg.preset.as_str(), "balanced" | "economy" | "max" | "custom") {
            return Err(anyhow!("unknown Auto preset {}", cfg.preset));
        }
        if let Some(k) = cfg.mode_slots.keys().find(|k| !MODES.contains(&k.as_str())) {
            return Err(anyhow!("unknown mode {k} in mode_slots"));
        }
        if cfg.budget_usd.is_some_and(|b| !b.is_finite() || b < 0.0) {
            return Err(anyhow!("budget_usd must be a positive number"));
        }
        self.auto.write().unwrap_or_else(|e| e.into_inner()).insert(provider.to_string(), cfg);
        Ok(())
    }

    pub fn auto_config(&self, provider: &str) -> AutoConfig {
        self.auto
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(provider)
            .cloned()
            .unwrap_or_default()
    }

    /// Source Auto routes within: the session's source if known, else the preferred provider,
    /// else the first HTTP provider that has models (catalog order).
    pub fn auto_source(&self, source: &str) -> String {
        if !source.is_empty() && self.provider(source).is_ok() {
            return source.to_string();
        }
        let pref = self.preferred();
        if !pref.is_empty() {
            return pref;
        }
        self.raw
            .providers
            .iter()
            .filter(|p| !p.is_cli())
            .find(|p| self.raw.models.iter().any(|m| m.provider == p.id))
            .map(|p| p.id.clone())
            .unwrap_or_default()
    }

    /// Models Auto may use on `provider`: the pool if set (opt-in models allowed when the user
    /// put them there), otherwise every non-opt-in model of the provider.
    fn auto_candidates(&self, provider: &str, cfg: &AutoConfig) -> Vec<&ModelEntry> {
        let of_provider = self.raw.models.iter().filter(|m| m.provider == provider);
        if cfg.pool.is_empty() {
            return of_provider.filter(|m| !m.opt_in).collect();
        }
        let pooled: Vec<&ModelEntry> = of_provider.clone().filter(|m| cfg.pool.contains(&m.id)).collect();
        if pooled.is_empty() {
            // A pool from another catalog version: better a default pick than no answer.
            return of_provider.filter(|m| !m.opt_in).collect();
        }
        pooled
    }

    /// Model for `slot` on `source` (see [`Catalog::auto_source`]).
    pub fn route_auto(&self, source: &str, slot: Slot, needs_vision: bool) -> Result<AutoPick> {
        let provider = self.auto_source(source);
        let cfg = self.auto_config(&provider);
        let cands = self.auto_candidates(&provider, &cfg);
        if cands.is_empty() {
            return Err(anyhow!("no model for Auto on source {provider}"));
        }
        let pinned = if cfg.preset == "custom" {
            let id = match slot {
                Slot::Frontier => &cfg.slots.frontier,
                Slot::Strong => &cfg.slots.strong,
                Slot::Small => &cfg.slots.small,
            };
            cands.iter().copied().find(|m| !id.is_empty() && m.id == *id)
        } else {
            None
        };
        let tier = preset_tier(&cfg.preset, slot);
        let mut pick = match pinned {
            Some(m) => m,
            None => nearest(&cands, tier_rank(tier)).expect("non-empty"),
        };
        let mut reason = match pinned {
            Some(_) => format!("custom · {}", slot.as_str()),
            None => format!("{} · {} → {tier}", preset_label(&cfg.preset), slot.as_str()),
        };
        if needs_vision && !pick.vision {
            let seeing: Vec<&ModelEntry> = cands.iter().copied().filter(|m| m.vision).collect();
            match nearest(&seeing, tier_rank(&pick.tier)) {
                Some(m) => {
                    reason.push_str(&format!(" · images → {}", m.id));
                    pick = m;
                }
                None => reason.push_str(" · no vision model in pool"),
            }
        }
        Ok(AutoPick { model_id: pick.id.clone(), slot, source: provider, reason })
    }

    /// The same model on another source, for evals run "on source X": same family first (the
    /// id before `@`: `claude-haiku` → `claude-haiku@api`), else the first non-opt-in model of
    /// the same tier there. `auto` stays `auto` (the session gets the source instead).
    pub fn same_model_on(&self, source: &str, id: &str) -> Result<String> {
        self.provider(source)?;
        if id == "auto" {
            return Ok(id.to_string());
        }
        let m = self.resolve(id)?;
        if m.provider == source {
            return Ok(m.id);
        }
        let family = |x: &str| x.split('@').next().unwrap_or(x).to_string();
        let fam = family(&m.id);
        let on: Vec<&ModelEntry> = self.raw.models.iter().filter(|x| x.provider == source).collect();
        if let Some(x) = on.iter().find(|x| family(&x.id) == fam) {
            return Ok(x.id.clone());
        }
        on.iter()
            .find(|x| !x.opt_in && x.tier == m.tier)
            .map(|x| x.id.clone())
            .ok_or_else(|| anyhow!("no {} model like {} on source {source}", m.tier, m.id))
    }

    /// The source's strongest model (highest tier, then highest output price): the baseline
    /// for "saved vs. all-Opus". Opt-in models count only when nothing else exists.
    pub fn baseline_model(&self, source: &str) -> Option<&ModelEntry> {
        let provider = self.auto_source(source);
        let of: Vec<&ModelEntry> = self.raw.models.iter().filter(|m| m.provider == provider).collect();
        let normal: Vec<&ModelEntry> = of.iter().copied().filter(|m| !m.opt_in).collect();
        let pool = if normal.is_empty() { of } else { normal };
        pool.into_iter().max_by(|a, b| {
            tier_rank(&a.tier)
                .cmp(&tier_rank(&b.tier))
                .then(a.output_cost_per_1m.total_cmp(&b.output_cost_per_1m))
                .then(std::cmp::Ordering::Greater) // keep the first on ties
        })
    }
}

fn preset_label(preset: &str) -> &str {
    if preset == "custom" {
        "balanced"
    } else {
        preset
    }
}

/// Closest tier to `rank`; on a tie the stronger one, then catalog order.
fn nearest<'a>(cands: &[&'a ModelEntry], rank: i32) -> Option<&'a ModelEntry> {
    let mut best: Option<(&ModelEntry, (i32, i32))> = None;
    for m in cands {
        let r = tier_rank(&m.tier);
        let key = ((r - rank).abs(), -r);
        if best.map(|(_, k)| key < k).unwrap_or(true) {
            best = Some((m, key));
        }
    }
    best.map(|(m, _)| m)
}

#[cfg(test)]
mod tests {
    use super::*;
    use silence_protocol::AutoSlots;

    const YAML: &str = r#"
version: 1
providers:
  - { id: gw, kind: openai_compat, base_url: "http://x" }
  - { id: cli, kind: claude_cli, command: claude }
models:
  - { id: gw-haiku, provider: gw, api_model: h, tier: fast, context_window: 1, vision: true, output_cost_per_1m: 5 }
  - { id: gw-sonnet, provider: gw, api_model: s, tier: mid, context_window: 1, output_cost_per_1m: 15 }
  - { id: gw-opus, provider: gw, api_model: o, tier: strong, context_window: 1, vision: true, output_cost_per_1m: 25 }
  - { id: cli-haiku, provider: cli, api_model: h, tier: fast, context_window: 1 }
  - { id: cli-sonnet, provider: cli, api_model: s, tier: mid, context_window: 1 }
  - { id: cli-opus, provider: cli, api_model: o, tier: strong, context_window: 1 }
  - { id: cli-fable, provider: cli, api_model: f, tier: strong, context_window: 1, opt_in: true, output_cost_per_1m: 99 }
"#;

    fn cat() -> Catalog {
        Catalog::from_yaml(YAML).unwrap()
    }

    fn pick(c: &Catalog, src: &str, slot: Slot) -> String {
        c.route_auto(src, slot, false).unwrap().model_id
    }

    #[test]
    fn balanced_is_opus_plan_sonnet_do_haiku_aux() {
        let c = cat();
        assert_eq!(pick(&c, "gw", Slot::Frontier), "gw-opus");
        assert_eq!(pick(&c, "gw", Slot::Strong), "gw-sonnet");
        assert_eq!(pick(&c, "gw", Slot::Small), "gw-haiku");
    }

    #[test]
    fn presets_move_tiers() {
        let c = cat();
        c.set_auto("gw", AutoConfig { preset: "economy".into(), ..Default::default() }).unwrap();
        assert_eq!(pick(&c, "gw", Slot::Frontier), "gw-sonnet");
        assert_eq!(pick(&c, "gw", Slot::Strong), "gw-haiku");
        c.set_auto("gw", AutoConfig { preset: "max".into(), ..Default::default() }).unwrap();
        assert_eq!(pick(&c, "gw", Slot::Strong), "gw-opus");
        assert_eq!(pick(&c, "gw", Slot::Small), "gw-haiku");
        assert!(c.set_auto("gw", AutoConfig { preset: "yolo".into(), ..Default::default() }).is_err());
    }

    #[test]
    fn custom_slots_and_fallback() {
        let c = cat();
        let cfg = AutoConfig {
            preset: "custom".into(),
            slots: AutoSlots { frontier: "gw-sonnet".into(), strong: "".into(), small: "nope".into() },
            ..Default::default()
        };
        c.set_auto("gw", cfg).unwrap();
        assert_eq!(pick(&c, "gw", Slot::Frontier), "gw-sonnet");
        assert_eq!(pick(&c, "gw", Slot::Strong), "gw-sonnet", "empty slot = balanced default");
        assert_eq!(pick(&c, "gw", Slot::Small), "gw-haiku", "unknown id = balanced default");
    }

    #[test]
    fn pool_limits_to_nearest_tier() {
        let c = cat();
        let cfg = AutoConfig { pool: vec!["gw-haiku".into(), "gw-sonnet".into()], ..Default::default() };
        c.set_auto("gw", cfg).unwrap();
        assert_eq!(pick(&c, "gw", Slot::Frontier), "gw-sonnet", "no Opus in pool → strongest left");
        assert_eq!(pick(&c, "gw", Slot::Small), "gw-haiku");
    }

    #[test]
    fn images_pick_a_vision_model_in_pool() {
        let c = cat();
        let p = c.route_auto("gw", Slot::Strong, true).unwrap();
        assert_eq!(p.model_id, "gw-opus", "Sonnet has no vision here; nearest seeing tier wins ties upward");
        c.set_auto("gw", AutoConfig { pool: vec!["gw-sonnet".into()], ..Default::default() }).unwrap();
        let p = c.route_auto("gw", Slot::Strong, true).unwrap();
        assert_eq!(p.model_id, "gw-sonnet");
        assert!(p.reason.contains("no vision"));
    }

    #[test]
    fn cli_source_routes_within_cli_and_skips_opt_in() {
        let c = cat();
        assert_eq!(pick(&c, "cli", Slot::Frontier), "cli-opus");
        assert_eq!(pick(&c, "cli", Slot::Small), "cli-haiku");
        assert_eq!(c.route_auto("cli", Slot::Strong, false).unwrap().source, "cli");
        // Opt-in models are fine once the user puts them in the pool.
        c.set_auto("cli", AutoConfig { pool: vec!["cli-fable".into(), "cli-haiku".into()], ..Default::default() })
            .unwrap();
        assert_eq!(pick(&c, "cli", Slot::Frontier), "cli-fable");
        assert_eq!(c.baseline_model("cli").unwrap().id, "cli-opus", "baseline ignores opt-in");
    }

    #[test]
    fn same_model_on_keeps_the_family_or_the_tier() {
        let c = cat();
        assert_eq!(c.same_model_on("cli", "gw-haiku").unwrap(), "cli-haiku", "same tier when no family match");
        assert_eq!(c.same_model_on("gw", "gw-haiku").unwrap(), "gw-haiku");
        assert_eq!(c.same_model_on("cli", "auto").unwrap(), "auto");
        assert!(c.same_model_on("nope", "gw-haiku").is_err());
        let y = r#"
version: 1
providers:
  - { id: gw, kind: openai_compat, base_url: "http://x" }
  - { id: api, kind: claude_api, base_url: "http://y" }
models:
  - { id: claude-haiku, provider: gw, api_model: h, tier: fast, context_window: 1 }
  - { id: claude-sonnet, provider: gw, api_model: s, tier: mid, context_window: 1 }
  - { id: claude-haiku@api, provider: api, api_model: h, tier: fast, context_window: 1 }
"#;
        let c = Catalog::from_yaml(y).unwrap();
        assert_eq!(c.same_model_on("api", "claude-haiku").unwrap(), "claude-haiku@api");
        assert!(c.same_model_on("api", "claude-sonnet").is_err(), "no mid model on api");
    }

    #[test]
    fn source_falls_back_to_preferred_then_first_http() {
        let c = cat();
        assert_eq!(c.auto_source(""), "gw");
        assert_eq!(c.auto_source("nope"), "gw");
        assert_eq!(c.auto_source("cli"), "cli");
        assert_eq!(c.baseline_model("").unwrap().id, "gw-opus");
    }
}
