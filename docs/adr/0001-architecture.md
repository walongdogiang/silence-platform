# ADR 0001 — Desktop Electron + Rust sidecar, không fork VS Code

**Status:** Accepted  
**Date:** 2026-10-23

## Context

Cần AI Engineer OS nội bộ trên Windows: agent loop, MCP, sub-agent, auto-model, chỉ nói chuyện với model công ty. Team nhỏ không thắng nếu clone IDE.

## Decision

1. **Electron + React + TypeScript** cho UI (chat, file tree, Monaco, xterm, diff, settings).
2. **Rust sidecar** (`silence-engine`) sở hữu harness: tools, MCP, sub-agent, router, sandbox, session, audit.
3. **JSON-RPC 2.0** qua **named pipe** Windows (`\\.\pipe\silence-<pid>`). Dev/non-Windows: TCP `127.0.0.1` loopback.
4. **Không napi-rs** làm đường chính — crash native không được kéo theo cả Electron.
5. **Editor = Monaco**, không fork VS Code / Code-OSS năm 1.
6. **Model gateway** OpenAI-compatible (`/v1/chat/completions`) + adapter Anthropic Messages.
7. **Protocol** một nguồn sự thật: `packages/protocol` (JSON Schema + TS) và `crates/protocol` (serde).

## Consequences

- Cập nhật sidecar độc lập với UI; dễ code-sign hai binary.
- Phải tự làm LSP-lite (Monaco) — chấp nhận; debug đầy đủ không phải năm 1.
- Windows Job Object / ConPTY nằm ở Rust, không ở Node.
- Eval runner gọi trực tiếp sidecar, không cần Electron.

## Alternatives rejected

- Fork VS Code: 1+ năm, lệch mục tiêu harness.
- Tauri: user đã chốt Electron.
- Thin wrap OpenCode/Cline: không sở hữu auto-model, permission, audit.
- Node sidecar: yếu sandbox/PTY/Job Object trên Windows so với Rust.
