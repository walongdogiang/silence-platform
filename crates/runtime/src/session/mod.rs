//! Session persistence: one append-only `events.jsonl` per session (ADR 0002).

pub mod log;

pub use log::{persisted_event, replay_messages, summarize, SessionStore};
