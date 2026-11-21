// Roadmap 1.5c: with `SILENCE_CORE=1`, chat sessions run on the TS core (Claude through the Agent SDK)
// instead of the Rust Engine. The renderer is unchanged: main routes each `silence-rpc` call here.
// Everything that is not a chat session (fs, terminal, evals, providers, history list) stays on the Engine.

export type Route =
  | { to: "engine" }
  | { to: "core"; method: string; params: Record<string, unknown> }
  /** Answered in main: the core has no equivalent yet and the renderer only needs a harmless reply. */
  | { to: "local"; result: unknown }
  | { to: "error"; message: string };

/** Session methods the core does not need yet: the renderer ignores their result. */
const NOOP_ON_CORE = new Set([
  "session.set_effort",
  "session.set_style",
  "session.set_permission",
  "session.carry_spend",
  "session.budget_continue",
  "session.approve_plan",
]);

const FORWARD = new Set(["session.prompt", "session.abort", "session.permission", "session.set_mode"]);

/**
 * Studio model id → Claude Code model. Catalog ids (`claude-opus`, `claude-opus@cli`, `claude-opus@api`)
 * become the alias (`opus`); a full Claude id passes through; anything else (Auto, other vendors) means
 * the default model of the user's Claude Code.
 */
export function toCoreModel(model: unknown): string | undefined {
  if (typeof model !== "string" || !model) return undefined;
  const alias = model.match(/^claude-(opus|sonnet|haiku|fable)(?:@(?:cli|api))?$/);
  if (alias) return alias[1];
  if (/^claude-[a-z]+-\d[\w.-]*$/.test(model)) return model;
  return undefined;
}

function record(params: unknown): Record<string, unknown> {
  return typeof params === "object" && params !== null ? (params as Record<string, unknown>) : {};
}

/** Where one renderer RPC goes. `coreSessions` = ids the core created in this run. */
export function routeRpc(method: string, params: unknown, coreOn: boolean, coreSessions: ReadonlySet<string>): Route {
  // Personal layer (~/.silence) lives in the core only: without it, say so instead of asking the Engine.
  if (method === "profile.status") return coreOn ? { to: "core", method, params: record(params) } : { to: "local", result: { available: false } };
  if (!coreOn) return { to: "engine" };
  const p = record(params);
  if (method === "session.create") {
    const model = toCoreModel(p.model);
    return {
      to: "core",
      method,
      params: { workspace: p.workspace, ...(p.mode ? { mode: p.mode } : {}), ...(model ? { model } : {}), ...(p.effort ? { effort: p.effort } : {}) },
    };
  }
  const sid = typeof p.session_id === "string" ? p.session_id : "";
  if (!sid || !coreSessions.has(sid)) return { to: "engine" };
  if (FORWARD.has(method)) return { to: "core", method, params: p };
  if (method === "session.set_model") return { to: "core", method, params: { session_id: sid, model: toCoreModel(p.model) ?? "" } };
  if (NOOP_ON_CORE.has(method)) return { to: "local", result: {} };
  return { to: "error", message: `${method} is not available on core sessions yet` };
}

/** `session.delete` lists several ids: core ones are closed on the core, the rest go to the Engine. */
export function splitDelete(params: unknown, coreSessions: ReadonlySet<string>): { core: string[]; engine: string[] } {
  const ids = record(params).session_ids;
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  return { core: list.filter((x) => coreSessions.has(x)), engine: list.filter((x) => !coreSessions.has(x)) };
}
