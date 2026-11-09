---
description: Mô hình đe doạ cho local agent trên Windows — tài sản, trust boundary, các mối đe doạ và biện pháp giảm thiểu.
type: spec
code:
  - crates/runtime/src/permissions.rs
  - crates/runtime/src/bind_policy.rs
  - crates/runtime/src/redact.rs
  - crates/sandbox/src/lib.rs
  - apps/studio/src/preload/index.ts
---
# Threat model — Windows local agent

## Assets

- Source code workspace
- Secrets in `.env`, credential files, clipboard (out of scope v1)
- Model API keys
- MCP server processes
- Audit logs (may contain code snippets)

## Trust boundary

Electron renderer is untrusted. Preload exposes a narrow RPC. Sidecar is trusted for fs/shell but must still ask before mutating. Model is untrusted: tool calls are attacker-controlled.

## Threats and mitigations

- **Prompt injection → RCE:** default permission `ask`; MCP không có shell mặc định; allowlist theo workspace.
- **Sidecar bind nhầm LAN:** named pipe / 127.0.0.1 only.
- **Secret leak lên model:** redaction regex (key, token, password, bearer) trước khi gửi.
- **MCP độc:** không auto-trust; user bật từng server; timeout + stdout cap.
- **Process treo / fork bomb:** timeout tool, Job Object kill-on-close, cwd jail.
- **Path escape:** canonicalize + phải nằm trong workspace roots (trừ khi user allow).
- **YOLO mode:** không mặc định; phải opt-in rõ.

Control plane / SSO không nằm trong MVP local — không mở attack surface mạng năm 1.
