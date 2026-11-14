//! Environment for child processes that must not see the Engine's secrets.
//!
//! The sandboxed shell (Phase 4 of the sandbox plan) starts from this list instead of the
//! Engine's whole environment: only names a build/test toolchain needs, and never anything that
//! looks like a credential.

use std::ffi::{OsStr, OsString};

/// Exact names passed through (case-insensitive, like Windows).
const ALLOW: &[&str] = &[
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "PROGRAMW6432",
    "COMMONPROGRAMFILES",
    "COMMONPROGRAMFILES(X86)",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
    "LANG",
    "LC_ALL",
    "TERM",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "RUSTUP_TOOLCHAIN",
    "NODE_ENV",
];

/// Prefixes passed through (case-insensitive).
const ALLOW_PREFIX: &[&str] = &["NPM_CONFIG_", "GIT_CONFIG_", "LC_"];

/// Substrings that always drop a variable, even if allowed above (case-insensitive).
const DENY_PART: &[&str] = &["TOKEN", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "API_KEY", "APIKEY"];

/// Exact names always dropped.
const DENY: &[&str] = &["SILENCE_API_KEY", "SILENCE_RPC_TOKEN", "SILENCE_API_BASE"];

/// Is `name` allowed into a sandboxed child's environment?
pub fn allowed(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else { return false };
    let up = name.to_ascii_uppercase();
    if DENY.contains(&up.as_str()) || DENY_PART.iter().any(|p| up.contains(p)) || up.ends_with("_KEY") {
        return false;
    }
    // `*_PROXY` (and npm_config_*proxy) may embed credentials (`http://user:pass@host`) and would
    // bypass the 5ilence proxy anyway; the sandbox sets its own (`ProxyCred::env`).
    if up.ends_with("PROXY") {
        return false;
    }
    ALLOW.contains(&up.as_str()) || ALLOW_PREFIX.iter().any(|p| up.starts_with(p))
}

/// Filter `vars` (usually `std::env::vars_os()`) down to the allowed names.
pub fn scrub<I>(vars: I) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    vars.into_iter().filter(|(k, _)| allowed(k)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[(&str, &str)]) -> Vec<String> {
        scrub(v.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))))
            .into_iter()
            .map(|(k, _)| k.into_string().unwrap())
            .collect()
    }

    #[test]
    fn keeps_toolchain_vars() {
        let kept = names(&[
            ("Path", "C:\\x"),
            ("SystemRoot", "C:\\Windows"),
            ("TEMP", "C:\\t"),
            ("CARGO_HOME", "C:\\c"),
            ("npm_config_cache", "C:\\n"),
            ("GIT_CONFIG_COUNT", "1"),
        ]);
        assert_eq!(kept.len(), 6, "{kept:?}");
    }

    #[test]
    fn drops_secrets_and_unknown() {
        let kept = names(&[
            ("SILENCE_API_KEY", "sk-x"),
            ("SILENCE_RPC_TOKEN", "t"),
            ("GITHUB_TOKEN", "ghp"),
            ("ANTHROPIC_API_KEY", "k"),
            ("OPENAI_API_KEY", "k"),
            ("AWS_SECRET_ACCESS_KEY", "k"),
            ("npm_config__authToken", "k"),
            ("GIT_CONFIG_PASSWORD", "k"),
            ("MY_SERVICE_KEY", "k"),
            ("HTTPS_PROXY", "http://corp:pw@proxy:8080"),
            ("npm_config_https_proxy", "http://corp:pw@proxy:8080"),
            ("RANDOM_THING", "x"),
        ]);
        assert!(kept.is_empty(), "leaked: {kept:?}");
    }
}
