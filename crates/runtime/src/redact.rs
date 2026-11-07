use regex::Regex;
use std::sync::OnceLock;

fn patterns() -> &'static [Regex] {
    static RE: OnceLock<Vec<Regex>> = OnceLock::new();
    RE.get_or_init(|| {
        [
            r"(?i)(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*\S{8,}",
            r"(?i)sk-[A-Za-z0-9]{16,}",
            r"(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*",
        ]
        .into_iter()
        .map(|p| Regex::new(p).expect("redact regex"))
        .collect()
    })
}

pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for re in patterns() {
        out = re.replace_all(&out, "[REDACTED]").into_owned();
    }
    out
}
