---
phase: 01-trusted-edit-loop
plan: 04
status: complete
requirements: [WIN-01, WIN-02, NET-01, METR-04]
completed: "2026-11-10"
---

# Plan 01-04 Summary — Windows shell UTF-8, long paths, loopback bind guard

## Done

- **Shell UTF-8 (`crates/tools/src/lib.rs`)**: the non-interactive `shell` tool prepends a PowerShell
  preamble that sets `[Console]::OutputEncoding` / `$OutputEncoding` to UTF-8 and defaults
  `Set-Content`, `Add-Content`, `Out-File`, `Get-Content` to `-Encoding utf8`. Job Object
  (`wrap_pid`) and the workspace cwd jail are unchanged. Interactive ConPTY (`pty.rs`) still
  defaults to `powershell.exe` — untouched.
  - Known trade-off: on Windows PowerShell 5.1 `utf8` writes a BOM (PowerShell 7 does not).
    Still correct for Vietnamese; ANSI was the bug.
- **Long paths**: `extended_path()` adds `\\?\` (and normalises `/` → `\`) to absolute paths ≥ 240
  chars on Windows. `Workspace::resolve` returns it for IO after the jail check on the plain path;
  `Workspace::rel` and `write` strip it for comparison/display.
- **Loopback bind guard (`crates/runtime/src/bind_policy.rs`, `main.rs`)**: `serve --tcp` calls
  `ensure_loopback_tcp_bind` before `TcpListener::bind`. Allows `127.0.0.0/8`, `::1`, `localhost`;
  refuses wildcards, LAN/public IPs and any other hostname. Studio still spawns
  `serve --tcp 127.0.0.1:0` (`apps/studio/src/main/index.ts:150`, unchanged).
- **Eval**: added `S23-shell-utf8-vietnamese` to `evals/v0/manifest.yaml`.
- **Tests**: `vietnamese_utf8_round_trip`, `long_nested_path_tool_io`, `bind_refuses_non_loopback`
  un-ignored and green; added unit tests for allowed/refused hosts.

## Verification

`cargo test -p silence-tools -p silence-engine -p silence-sandbox` — all pass (tools 14, engine 47 +
bind guard 1).

## Not run

- Live `npm run evals` (no `SILENCE_API_BASE` / `SILENCE_API_KEY`); the S23 task definition is on
  disk but unexecuted.
- Manual Studio smoke (kill renderer, Engine survives) from VALIDATION.md.
- `vietnamese_utf8_round_trip` is `#[cfg(windows)]` (uses PowerShell cmdlets).
