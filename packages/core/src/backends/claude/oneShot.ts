// One short Claude call with no tools (roadmap 1.9: the lesson proposal). Uses the subscription login
// like ClaudeBackend: same allowlisted env, and the call fails if Claude Code would use an API key.
import { query as sdkQuery, type Options } from "@anthropic-ai/claude-agent-sdk";
import { claudeEnv, SUBSCRIPTION_KEY_SOURCE } from "./env.js";

export interface OneShotResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number; usd: number };
  model: string;
}

/** `prompt` as a plain string (no streaming input needed for a single turn). */
export type OneShotQueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<unknown>;

export interface OneShotOptions {
  /** Claude Code model alias or id (default `haiku`). */
  model?: string;
  cwd: string;
  queryFn?: OneShotQueryFn;
  env?: NodeJS.ProcessEnv;
  /** Reject when the login is not the subscription (default true). */
  requireSubscription?: boolean;
}

export async function claudeOneShot(system: string, prompt: string, o: OneShotOptions): Promise<OneShotResult> {
  const queryFn = o.queryFn ?? (sdkQuery as unknown as OneShotQueryFn);
  const options = {
    cwd: o.cwd,
    env: claudeEnv(o.env),
    model: o.model ?? "haiku",
    systemPrompt: system,
    tools: [],
    settingSources: [],
    permissionMode: "default",
    maxTurns: 1,
    // Do not leave a transcript in ~/.claude (it would show up as an outside session).
    persistSession: false,
    // No tool should ever run here; refuse anything that slips through.
    canUseTool: async () => ({ behavior: "deny", message: "no tools in a one-shot call" }),
  } as unknown as Options;
  let text = "";
  let model = o.model ?? "haiku";
  let usage = { inputTokens: 0, outputTokens: 0, usd: 0 };
  for await (const raw of queryFn({ prompt, options })) {
    const m = raw as Record<string, unknown> & { type?: string; subtype?: string };
    if (m.type === "system" && m.subtype === "init") {
      model = String(m.model ?? model);
      const source = String(m.apiKeySource ?? "");
      if ((o.requireSubscription ?? true) && source !== SUBSCRIPTION_KEY_SOURCE) throw new Error(`Claude is using credential source "${source}", not the subscription login`);
    } else if (m.type === "assistant") {
      const content = (m.message as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content ?? [];
      const t = content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      if (t) text = t;
    } else if (m.type === "result") {
      const u = (m.usage ?? {}) as Record<string, number>;
      usage = { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, usd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : 0 };
      if (m.subtype !== "success") throw new Error(`Claude call ended with ${String(m.subtype)}`);
      if (typeof m.result === "string" && m.result) text = m.result;
    }
  }
  if (!text.trim()) throw new Error("Claude returned no text");
  return { text, usage, model };
}
