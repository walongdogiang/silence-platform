//! TCP bind host policy — loopback / named-pipe only (NET-01).
//!
//! Wave 0 stub accepts every host so `bind_refuses_non_loopback` stays red until Plan 01-04.

use anyhow::Result;

/// Refuse non-loopback TCP bind targets before `TcpListener::bind`.
///
/// Wave 0: always `Ok(())` (unsafe). Plan 01-04 rejects `0.0.0.0`, `*`, and LAN literals.
pub fn ensure_loopback_tcp_bind(addr: &str) -> Result<()> {
    let _ = addr;
    Ok(())
}
