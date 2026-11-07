---
paths:
  - "crates/**"
  - "scripts/**"
---

# Rust harness

- Windows NFR: ConPTY, long paths, UTF-8/UTF-16. Job Object kill-on-close. Tool cwd stays in workspace jail.
- Electron spawn uses TCP `127.0.0.1` (ephemeral port). Named pipe / Unix socket only when runtime is not given `--tcp`.
- Mutating tools: permission default `ask` + audit. No silent YOLO. MCP has no shell by default; do not auto-trust servers.
- Do not use napi-rs as the primary UI↔runtime IPC path. Sidecar stays a separate process.
- Bind loopback / named pipe only — never LAN.
- Harness/agent-loop change: add or edit an eval task. Run `cargo test -p silence-tools` when touching tools. Run `npm run evals` if API keys exist; otherwise say they were not run.
