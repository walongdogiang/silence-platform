use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde::Deserialize;
use silence_protocol::{AutoConfig, ModelInfo};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};

mod auto;
pub use auto::{preset_tier, tier_rank, AutoPick};

/// Provider kind whose models run through the local `claude` CLI, not an HTTP API.
/// Tier lookups never pick these; Auto does only when the session's source is the CLI.
pub const KIND_CLAUDE_CLI: &str = "claude_cli";
pub const KIND_OPENAI_COMPAT: &str = "openai_compat";
const ALL_EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogFile {
    pub version: u32,
    #[serde(default)]
    pub default_model: String,
    pub providers: Vec<Provider>,
    pub models: Vec<ModelEntry>,
    #[serde(default)]
    pub escalation: Escalation,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Provider {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key_env: String,
    /// Shown in the model picker and Settings ("Claude API", "OpenRouter", …).
    #[serde(default)]
    pub label: String,
    /// Executable for `claude_cli` providers (default `claude`).
    #[serde(default)]
    pub command: String,
}

impl Provider {
    pub fn display_label(&self) -> String {
        if self.label.is_empty() {
            self.id.clone()
        } else {
            self.label.clone()
        }
    }

    pub fn is_cli(&self) -> bool {
        self.kind == KIND_CLAUDE_CLI
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub provider: String,
    pub api_model: String,
    pub tier: String,
    pub context_window: u32,
    #[serde(default)]
    pub max_output_tokens: u32,
    #[serde(default = "default_true")]
    pub tools: bool,
    #[serde(default)]
    pub vision: bool,
    #[serde(default)]
    pub input_cost_per_1m: f64,
    #[serde(default)]
    pub output_cost_per_1m: f64,
    /// Effort levels the model accepts (`low|medium|high|xhigh|max`); empty = no effort control.
    #[serde(default)]
    pub efforts: Vec<String>,
    /// Fallback when the picked level is not in `efforts`; the UI marks it "Recommended".
    /// Empty when `efforts` is empty.
    #[serde(default)]
    pub default_effort: String,
    /// Off until the user switches it on in Settings (costly models). Never picked by Auto,
    /// tier lookups or escalation.
    #[serde(default)]
    pub opt_in: bool,
}

impl ModelEntry {
    /// The effort to send for a session preference: `None` = send nothing (model without
    /// effort control). `auto` and a level the model does not accept both resolve to
    /// `default_effort`, sent explicitly: provider defaults differ per model, and the UI shows
    /// this level as the one in use.
    pub fn effective_effort(&self, wanted: &str) -> Option<String> {
        if self.efforts.is_empty() {
            return None;
        }
        if self.efforts.iter().any(|e| e == wanted) {
            return Some(wanted.to_string());
        }
        (!self.default_effort.is_empty()).then(|| self.default_effort.clone())
    }
}

fn default_true() -> bool {
    true
}

/// Signals that let Auto escalate (`test_fail_after_edit`, `repeated_tool_error`, `no_progress`,
/// `empty_output`, `provider_retry`). Empty = all on.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct Escalation {
    #[serde(default)]
    pub on: Vec<String>,
}

impl Escalation {
    pub fn enabled(&self, signal: &str) -> bool {
        self.on.is_empty() || self.on.iter().any(|s| s == signal)
    }
}

#[derive(Debug, Clone)]
pub struct Catalog {
    pub raw: CatalogFile,
    /// Provider id Auto / tier lookups prefer (Settings → Model sources). Empty = catalog order.
    preferred: Arc<RwLock<String>>,
    /// Keys set at runtime from Settings (provider id → key). Win over the env var.
    credentials: Arc<RwLock<HashMap<String, String>>>,
    /// Auto settings per provider (`auto.set_config`). Missing = `AutoConfig::default()`.
    auto: Arc<RwLock<HashMap<String, AutoConfig>>>,
}

impl Catalog {
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let text = std::fs::read_to_string(path.as_ref()).context("read models.yaml")?;
        Self::from_yaml(&text)
    }

    pub fn from_yaml(text: &str) -> Result<Self> {
        let expanded = expand_env(text);
        let raw: CatalogFile = serde_yaml::from_str(&expanded).context("parse models.yaml")?;
        Ok(Self::from_raw(raw))
    }

    pub fn from_raw(mut raw: CatalogFile) -> Self {
        // Every OpenAI-compatible model gets the effort picker: OpenRouter takes
        // `reasoning.effort` for any model (non-reasoning ones ignore it). Models the catalog does
        // not tune get no `default_effort`, so `auto` still sends nothing for them.
        let openai: Vec<String> = raw
            .providers
            .iter()
            .filter(|p| p.kind == KIND_OPENAI_COMPAT)
            .map(|p| p.id.clone())
            .collect();
        for m in raw.models.iter_mut() {
            if m.efforts.is_empty() && openai.contains(&m.provider) {
                m.efforts = ALL_EFFORTS.iter().map(|s| s.to_string()).collect();
            }
        }
        Self {
            raw,
            preferred: Arc::new(RwLock::new(String::new())),
            credentials: Arc::new(RwLock::new(HashMap::new())),
            auto: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn provider(&self, id: &str) -> Result<&Provider> {
        self.raw
            .providers
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| anyhow!("unknown provider {id}"))
    }

    /// Set the provider tier lookups (and Auto without a session source) prefer. `""` = catalog
    /// order. A CLI provider is refused: Auto on the CLI comes from the session's source.
    pub fn set_preferred(&self, provider_id: &str) -> Result<()> {
        if !provider_id.is_empty() && self.provider(provider_id)?.is_cli() {
            return Err(anyhow!("Auto cannot route to the Claude CLI; pick a CLI model explicitly"));
        }
        *self.preferred.write().unwrap_or_else(|e| e.into_inner()) = provider_id.to_string();
        Ok(())
    }

    pub fn preferred(&self) -> String {
        self.preferred.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Set (or clear with `""`) the runtime key of a provider.
    pub fn set_credential(&self, provider_id: &str, key: &str) -> Result<()> {
        self.provider(provider_id)?;
        let mut map = self.credentials.write().unwrap_or_else(|e| e.into_inner());
        if key.is_empty() {
            map.remove(provider_id);
        } else {
            map.insert(provider_id.to_string(), key.to_string());
        }
        Ok(())
    }

    fn is_cli_model(&self, m: &ModelEntry) -> bool {
        self.provider_for(m).is_ok_and(Provider::is_cli)
    }

    /// Auto / tier candidates: HTTP providers only, the preferred provider first.
    fn tier_candidates(&self) -> Vec<&ModelEntry> {
        let pref = self.preferred();
        let http: Vec<&ModelEntry> = self
            .raw
            .models
            .iter()
            .filter(|m| !self.is_cli_model(m) && !m.opt_in)
            .collect();
        let (mut first, rest): (Vec<_>, Vec<_>) = http.into_iter().partition(|m| m.provider == pref);
        first.extend(rest);
        first
    }

    /// First vision-capable model Auto may use (preferred provider first).
    pub fn vision_model(&self) -> Option<&ModelEntry> {
        self.tier_candidates().into_iter().find(|m| m.vision)
    }

    pub fn model(&self, id: &str) -> Result<&ModelEntry> {
        self.raw
            .models
            .iter()
            .find(|m| m.id == id)
            .ok_or_else(|| anyhow!("unknown model {id}"))
    }

    pub fn resolve(&self, id: &str) -> Result<ModelEntry> {
        if let Ok(m) = self.model(id) {
            return Ok(m.clone());
        }
        if id.contains('/') {
            let first = self.raw.providers.first().ok_or_else(|| anyhow!("no provider"))?;
            let provider = first.id.clone();
            let efforts = if first.kind == KIND_OPENAI_COMPAT {
                ALL_EFFORTS.iter().map(|s| s.to_string()).collect()
            } else {
                Vec::new()
            };
            return Ok(ModelEntry {
                id: id.to_string(),
                label: id.to_string(),
                provider,
                api_model: id.to_string(),
                tier: "mid".into(),
                context_window: 128_000,
                max_output_tokens: 8192,
                tools: true,
                vision: false,
                input_cost_per_1m: 0.0,
                output_cost_per_1m: 0.0,
                efforts,
                default_effort: String::new(),
                opt_in: false,
            });
        }
        Err(anyhow!("unknown model {id}"))
    }

    pub fn provider_for(&self, model: &ModelEntry) -> Result<&Provider> {
        self.raw
            .providers
            .iter()
            .find(|p| p.id == model.provider)
            .ok_or_else(|| anyhow!("unknown provider {}", model.provider))
    }

    /// Picker rows. `available` here only checks that a keyed provider has a key; the Engine
    /// refines it for the CLI (installed / signed in).
    pub fn infos(&self) -> Vec<ModelInfo> {
        self.raw
            .models
            .iter()
            .map(|m| {
                let provider = self.provider_for(m).ok();
                let (available, reason) = match provider {
                    Some(p) if !p.api_key_env.is_empty() && self.api_key(p).is_empty() => {
                        (false, format!("No {} key", p.display_label()))
                    }
                    Some(_) => (true, String::new()),
                    None => (false, format!("Unknown provider {}", m.provider)),
                };
                (m, provider, available, reason)
            })
            .map(|(m, provider, available, unavailable_reason)| ModelInfo {
                provider: m.provider.clone(),
                provider_label: provider.map(Provider::display_label).unwrap_or_default(),
                provider_kind: provider.map(|p| p.kind.clone()).unwrap_or_default(),
                available,
                unavailable_reason,
                id: m.id.clone(),
                label: if m.label.is_empty() {
                    m.id.clone()
                } else {
                    m.label.clone()
                },
                api_model: m.api_model.clone(),
                tier: m.tier.clone(),
                context_window: m.context_window,
                tools: m.tools,
                vision: m.vision,
                efforts: m.efforts.clone(),
                default_effort: m.default_effort.clone(),
                opt_in: m.opt_in,
            })
            .collect()
    }

    /// Model of `tier` for Auto, sub-agents, titles, escalation: HTTP providers only, the
    /// preferred provider first, then catalog order.
    pub fn by_tier(&self, tier: &str) -> Result<&ModelEntry> {
        self.tier_candidates()
            .into_iter()
            .find(|m| m.tier == tier)
            .ok_or_else(|| anyhow!("no model for tier {tier}"))
    }

    pub fn api_key(&self, provider: &Provider) -> String {
        if let Some(k) = self
            .credentials
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(&provider.id)
        {
            return k.clone();
        }
        if provider.api_key_env.is_empty() {
            return String::new();
        }
        std::env::var(&provider.api_key_env).unwrap_or_default()
    }
}

fn expand_env(text: &str) -> String {
    let re = Regex::new(r"\$\{([A-Z0-9_]+)(?::-([^}]*))?\}").expect("regex");
    re.replace_all(text, |caps: &regex::Captures| {
        let key = &caps[1];
        let default = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        std::env::var(key).unwrap_or_else(|_| default.to_string())
    })
    .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const YAML: &str = r#"
version: 1
providers:
  - { id: gw, kind: openai_compat, base_url: "http://x", api_key_env: SILENCE_TEST_NO_SUCH_KEY_1 }
  - { id: api, kind: claude_api, base_url: "http://y", api_key_env: SILENCE_TEST_NO_SUCH_KEY_2 }
  - { id: cli, kind: claude_cli, command: claude }
models:
  - { id: cli-strong, provider: cli, api_model: o, tier: strong, context_window: 1, vision: true }
  - { id: gw-strong, provider: gw, api_model: o, tier: strong, context_window: 1 }
  - { id: api-strong, provider: api, api_model: o, tier: strong, context_window: 1, vision: true,
      efforts: [low, medium, high], default_effort: medium }
"#;

    #[test]
    fn tier_skips_cli_and_follows_preferred_provider() {
        let c = Catalog::from_yaml(YAML).unwrap();
        assert_eq!(c.by_tier("strong").unwrap().id, "gw-strong");
        c.set_preferred("api").unwrap();
        assert_eq!(c.by_tier("strong").unwrap().id, "api-strong");
        assert_eq!(c.vision_model().unwrap().id, "api-strong");
        assert!(c.set_preferred("cli").is_err(), "tier lookups never use the CLI");
        c.set_preferred("").unwrap();
        assert_eq!(c.by_tier("strong").unwrap().id, "gw-strong");
    }

    #[test]
    fn runtime_credential_wins_and_marks_available() {
        let c = Catalog::from_yaml(YAML).unwrap();
        let api = c.provider("api").unwrap().clone();
        assert_eq!(c.api_key(&api), "");
        let info = c.infos().into_iter().find(|m| m.id == "api-strong").unwrap();
        assert!(!info.available);
        assert_eq!(info.provider_kind, "claude_api");
        c.set_credential("api", "sk-test").unwrap();
        assert_eq!(c.api_key(&api), "sk-test");
        assert!(c.infos().into_iter().find(|m| m.id == "api-strong").unwrap().available);
        c.set_credential("api", "").unwrap();
        assert_eq!(c.api_key(&api), "");
        assert!(c.set_credential("nope", "k").is_err());
    }

    #[test]
    fn effort_maps_to_what_the_model_accepts() {
        let c = Catalog::from_yaml(YAML).unwrap();
        let m = c.model("api-strong").unwrap();
        assert_eq!(m.effective_effort("auto").as_deref(), Some("medium"), "auto sends the recommended level");
        assert_eq!(m.effective_effort("high").as_deref(), Some("high"));
        assert_eq!(m.effective_effort("max").as_deref(), Some("medium"));
        // OpenAI-compatible models without tuning: every level pickable, `auto` sends nothing.
        let gw = c.model("gw-strong").unwrap();
        assert_eq!(gw.efforts.len(), 5);
        assert_eq!(gw.effective_effort("max").as_deref(), Some("max"));
        assert_eq!(gw.effective_effort("auto"), None);
        assert_eq!(c.resolve("vendor/x").unwrap().efforts.len(), 5, "ad-hoc ids too");
        // CLI models keep what the catalog declares (none here).
        assert!(c.model("cli-strong").unwrap().efforts.is_empty());
    }

    #[test]
    fn shipped_catalog_parses() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/models.yaml");
        let c = Catalog::load(path).unwrap();
        assert_eq!(c.raw.providers[0].id, "company-gateway", "ad-hoc ids use the first provider");
        for m in &c.raw.models {
            c.provider_for(m).unwrap();
            assert!(!m.efforts.is_empty(), "{}: every shipped model has an effort picker", m.id);
            if !m.default_effort.is_empty() {
                assert!(m.efforts.contains(&m.default_effort), "{}", m.id);
            }
        }
        assert!(c.model("claude-opus@api").is_ok());
        assert!(c.model("claude-sonnet@cli").is_ok());
        let fable = c.infos().into_iter().find(|m| m.id == "claude-fable@cli").expect("fable in catalog");
        assert!(fable.opt_in, "Fable is off until switched on in Settings");
    }

    #[test]
    fn opt_in_models_are_never_auto_picked() {
        let yaml = r#"
version: 1
providers:
  - { id: gw, kind: openai_compat, base_url: "http://x" }
models:
  - { id: pricey, provider: gw, api_model: p, tier: strong, context_window: 1, vision: true, opt_in: true }
  - { id: normal, provider: gw, api_model: n, tier: strong, context_window: 1, vision: true }
"#;
        let c = Catalog::from_yaml(yaml).unwrap();
        assert_eq!(c.by_tier("strong").unwrap().id, "normal");
        assert_eq!(c.vision_model().unwrap().id, "normal");
        // Still resolvable when the user picks it explicitly.
        assert!(c.resolve("pricey").is_ok());
    }
}
