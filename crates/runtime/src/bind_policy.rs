//! TCP bind host policy — loopback / named-pipe only (NET-01).

use anyhow::{bail, Result};
use std::net::IpAddr;

/// Refuse non-loopback TCP bind targets before `TcpListener::bind`.
///
/// Accepts `127.0.0.0/8`, `::1` and the literal `localhost` (with or without a port, IPv6 in
/// brackets). Rejects wildcards (`0.0.0.0`, `::`, `*`), LAN/public addresses, empty hosts and any
/// other hostname — a name could resolve to a LAN address, so it is never trusted.
pub fn ensure_loopback_tcp_bind(addr: &str) -> Result<()> {
    let host = host_of(addr.trim());
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }
    match host.parse::<IpAddr>() {
        Ok(ip) if ip.is_loopback() => Ok(()),
        _ => bail!("refusing to bind {addr:?}: only loopback (127.0.0.1, ::1, localhost) is allowed"),
    }
}

/// Host part of `host:port`, `[v6]:port`, or a bare host / IPv6 literal.
fn host_of(addr: &str) -> &str {
    if let Some(rest) = addr.strip_prefix('[') {
        return rest.split(']').next().unwrap_or("");
    }
    // A bare IPv6 literal has several colons and no port; `host:port` has exactly one.
    if addr.matches(':').count() == 1 {
        return addr.split(':').next().unwrap_or("");
    }
    addr
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_loopback_forms() {
        for a in [
            "127.0.0.1:0",
            "127.0.0.1:8080",
            "127.0.0.2:1",
            "localhost:0",
            "LOCALHOST:9",
            "[::1]:0",
            "::1",
            "127.0.0.1",
        ] {
            assert!(ensure_loopback_tcp_bind(a).is_ok(), "should allow {a}");
        }
    }

    #[test]
    fn refuses_everything_else() {
        for a in [
            "0.0.0.0:0",
            "[::]:0",
            "::",
            "*:0",
            "192.168.1.10:9000",
            "10.0.0.5:1",
            "8.8.8.8:53",
            "example.com:80",
            ":8080",
            "",
        ] {
            assert!(ensure_loopback_tcp_bind(a).is_err(), "should refuse {a}");
        }
    }
}
