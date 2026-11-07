use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde::Deserialize;
use silence_protocol::{ModelInfo, TaskClass};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
pub struct CatalogFile {
    pub version: u32,
    #[serde(default)]
    pub default_model: String,
    #[serde(default)]
    pub optimize: String,
    pub providers: Vec<Provider>,
    pub models: Vec<ModelEntry>,
    pub routes: HashMap<String, String>,
    #[serde(default)]
    pub escalation: Escalation,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Provider {
    pub id: String,
    pub kind: String,
    pub base_url: String,
    #[serde(default)]
    pub api_key_env: String,
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
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct Escalation {
    #[serde(default)]
    pub on: Vec<String>,
    #[serde(default)]
    pub to: String,
}

#[derive(Debug, Clone)]
pub struct Catalog {
    pub raw: CatalogFile,
}

impl Catalog {
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let text = std::fs::read_to_string(path.as_ref()).context("read models.yaml")?;
        let expanded = expand_env(&text);
        let raw: CatalogFile = serde_yaml::from_str(&expanded).context("parse models.yaml")?;
        Ok(Self { raw })
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
            let provider = self
                .raw
                .providers
                .first()
                .ok_or_else(|| anyhow!("no provider"))?
                .id
                .clone();
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

    pub fn infos(&self) -> Vec<ModelInfo> {
        self.raw
            .models
            .iter()
            .map(|m| ModelInfo {
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
            })
            .collect()
    }

    pub fn by_tier(&self, tier: &str) -> Result<&ModelEntry> {
        self.raw
            .models
            .iter()
            .find(|m| m.tier == tier)
            .ok_or_else(|| anyhow!("no model for tier {tier}"))
    }

    pub fn api_key(&self, provider: &Provider) -> String {
        if provider.api_key_env.is_empty() {
            return String::new();
        }
        std::env::var(&provider.api_key_env).unwrap_or_default()
    }
}

pub fn classify(text: &str) -> TaskClass {
    let t = text.to_lowercase();
    let architect = ["architect", "thiết kế", "design system", "adr", "refactor lớn"];
    let debug = ["bug", "fail", "error", "panic", "stack trace", "sửa lỗi", "không chạy"];
    let explore = ["where", "tìm", "liệt kê", "explain", "đọc", "explore", "mô tả"];
    let edit = ["thêm", "sửa", "implement", "add ", "fix ", "đổi", "write"];
    if architect.iter().any(|k| t.contains(k)) {
        return TaskClass::Architect;
    }
    if debug.iter().any(|k| t.contains(k)) {
        return TaskClass::Debug;
    }
    if edit.iter().any(|k| t.contains(k)) {
        return TaskClass::Edit;
    }
    if explore.iter().any(|k| t.contains(k)) {
        return TaskClass::Explore;
    }
    TaskClass::Chat
}

pub struct RouteDecision {
    pub task_class: TaskClass,
    pub model_id: String,
    pub reason: String,
}

pub fn route(catalog: &Catalog, requested: &str, user_text: &str) -> Result<RouteDecision> {
    if requested != "auto" && !requested.is_empty() {
        catalog.resolve(requested)?;
        return Ok(RouteDecision {
            task_class: classify(user_text),
            model_id: requested.to_string(),
            reason: "user override".into(),
        });
    }
    let class = classify(user_text);
    let tier = catalog
        .raw
        .routes
        .get(class.as_str())
        .map(|s| s.as_str())
        .unwrap_or("mid");
    let model = catalog.by_tier(tier)?;
    Ok(RouteDecision {
        task_class: class,
        model_id: model.id.clone(),
        reason: format!("auto {} -> tier {tier}", class.as_str()),
    })
}

pub fn escalate(catalog: &Catalog, reason: &str) -> Result<String> {
    let to = if catalog.raw.escalation.to.is_empty() {
        "strong"
    } else {
        catalog.raw.escalation.to.as_str()
    };
    if catalog
        .raw
        .escalation
        .on
        .iter()
        .any(|x| x == reason || catalog.raw.escalation.on.is_empty())
    {
        return Ok(catalog.by_tier(to)?.id.clone());
    }
    Ok(catalog.by_tier(to)?.id.clone())
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
