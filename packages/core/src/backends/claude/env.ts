// Environment for the Claude Code process. Built from an allowlist, never a copy of process.env:
// the spike showed an inherited env leaks the host app's tools into the session, and any API key
// variable would silently override the Pro login (docs/adapters/claude-sdk.md).

const KEEP = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "ComSpec",
  "SystemDrive",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "USERPROFILE",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "USERDOMAIN",
  "USER",
  "LOGNAME",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SHELL",
  "TERM",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "CLAUDE_CODE_GIT_BASH_PATH",
  "CLAUDE_CONFIG_DIR",
];

/** Variables that switch Claude Code to another credential or provider; never passed. */
export const AUTH_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "ANTHROPIC_BASE_URL",
];

export function claudeEnv(from: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP) {
    const v = from[k];
    if (v !== undefined && !AUTH_VARS.includes(k)) out[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) if (!AUTH_VARS.includes(k)) out[k] = v;
  return out;
}

/** `apiKeySource` of a Pro/Max login (spike 2026-11-19). Anything else means another credential is in use. */
export const SUBSCRIPTION_KEY_SOURCE = "none";
