// Built-in risk policy, loaded from packages/core/policy/default_policy.yaml (same file the Rust
// Engine embeds until it is removed; a test keeps the two copies identical).
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export type Tier = "auto" | "logged" | "ask" | "block";
export const TIER_ORDER: Record<Tier, number> = { auto: 0, logged: 1, ask: 2, block: 3 };

export interface CodeInfo {
  tier: Tier;
  title: string;
  detail: string;
  hint: string;
}

export interface CommandRule {
  match: string[];
  code: string;
  flags_any?: string[];
}

export interface Policy {
  codes: Record<string, CodeInfo>;
  aliases: Record<string, string>;
  commands: CommandRule[];
  exec_sinks: string[];
  downloaders: string[];
  interpreters: string[];
  inline_flags: string[];
  encoded_flags: string[];
  upload_flags: string[];
  secret_patterns: string[];
  policy_files: string[];
  never_remember: string[];
  taint_codes: string[];
  subcommand_programs: string[];
  sandbox_covers: string[];
  always_ask: string[];
  never_escalate: string[];
}

/** URL of the policy file; resolves from both `src/risk` and `dist/risk`. */
export const POLICY_URL = new URL("../../policy/default_policy.yaml", import.meta.url);
export const CORPUS_URL = new URL("../../policy/corpus.yaml", import.meta.url);

let cached: Policy | null = null;

export function policy(): Policy {
  if (!cached) cached = loadPolicy(readFileSync(POLICY_URL, "utf8"));
  return cached;
}

export function loadPolicy(text: string): Policy {
  const p = parseYaml(text) as Policy;
  for (const key of ["codes", "aliases", "commands"] as const) {
    if (!p?.[key]) throw new Error(`risk policy is missing \`${key}\``);
  }
  // YAML 1.2 reads bare `true`, `null`, numbers as non-strings (`match: [true]` is the `true`
  // program). The Rust loader types them as strings; do the same so every rule can match.
  const str = (xs: unknown[] | undefined) => (xs ?? []).map((x) => String(x));
  for (const r of p.commands) {
    r.match = str(r.match);
    if (r.flags_any) r.flags_any = str(r.flags_any);
  }
  for (const key of ["exec_sinks", "downloaders", "interpreters", "inline_flags", "encoded_flags", "upload_flags", "secret_patterns", "policy_files", "never_remember", "taint_codes", "subcommand_programs", "sandbox_covers", "always_ask", "never_escalate"] as const) {
    p[key] = str(p[key]);
  }
  p.aliases = Object.fromEntries(Object.entries(p.aliases).map(([k, v]) => [String(k), String(v)]));
  return p;
}

export function tierOf(code: string): Tier {
  return policy().codes[code]?.tier ?? "ask";
}
