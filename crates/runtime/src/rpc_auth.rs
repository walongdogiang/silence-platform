//! RPC connection auth (`auth.hello`).
//!
//! The Engine listens on loopback, and Windows Firewall does not filter loopback, so any local
//! process — including a sandboxed command — can connect. Every connection must therefore
//! open with `auth.hello {token}`. Studio generates the token, passes it to the Engine in
//! `SILENCE_RPC_TOKEN`, and the Engine removes it from its own environment at once so shell
//! commands, hooks and MCP servers never inherit it.

use uuid::Uuid;

pub const TOKEN_ENV: &str = "SILENCE_RPC_TOKEN";
/// JSON-RPC error code for a connection that did not authenticate.
pub const UNAUTHORIZED: i32 = -32001;
const MIN_LEN: usize = 32;

/// Token for this Engine process. Reads and removes `SILENCE_RPC_TOKEN`; a missing or short
/// value is replaced by a fresh random one. Returns `(token, generated)`.
pub fn take_from_env() -> (String, bool) {
    let from_env = std::env::var(TOKEN_ENV).ok();
    // Edition 2021: safe. Called at startup, before any child process is spawned.
    std::env::remove_var(TOKEN_ENV);
    match from_env {
        Some(t) if t.len() >= MIN_LEN => (t, false),
        _ => (generate(), true),
    }
}

/// 2 × UUIDv4 (OS CSPRNG): ~244 random bits, hex.
pub fn generate() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// Constant-time comparison (length is not secret).
pub fn token_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_long_and_distinct() {
        let (a, b) = (generate(), generate());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
    }

    #[test]
    fn compares() {
        assert!(token_eq("abc", "abc"));
        assert!(!token_eq("abc", "abd"));
        assert!(!token_eq("abc", "abcd"));
    }
}
