/** Parsing for Settings → Tools → Add MCP server. Pure, so it is unit-tested. */

/** Split an args line like a shell would for simple cases: spaces separate, "double quotes" group. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let has = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      has = true;
    } else if (/\s/.test(ch) && !quoted) {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** `KEY=value` per line → pairs. Blank lines skipped; a line without `=` or with a bad name is an error. */
export function parseEnv(text: string): { env: [string, string][]; bad: string | null } {
  const env: [string, string][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf("=");
    const key = i > 0 ? line.slice(0, i).trim() : "";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { env, bad: line };
    env.push([key, line.slice(i + 1).trim()]);
  }
  return { env, bad: null };
}

/** True when a value looks pasted in plain text rather than a `${VAR}` reference. */
export function hasLiteralSecret(env: [string, string][]): boolean {
  return env.some(([, v]) => v !== "" && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v));
}

/** Same rule as the Engine (`mcp_config::valid_name`). */
export function validServerName(name: string): boolean {
  return name.length > 0 && name.length <= 40 && !name.includes("__") && /^[A-Za-z0-9_-]+$/.test(name);
}

/** One line the user reads before the Engine runs it. */
export function commandLine(command: string, args: string[]): string {
  return [command, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
}
