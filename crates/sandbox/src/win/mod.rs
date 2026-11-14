//! Windows backend (Phase 2 of the sandbox plan). See `crates/sandbox/spike/README.md` for why
//! each piece looks the way it does.

pub mod account;
pub mod acl;
pub mod job;
pub mod launch;
pub mod proc;
pub mod runner;
pub mod setup;
pub mod sid;
pub mod state;
pub mod token;

#[cfg(test)]
mod tests;
