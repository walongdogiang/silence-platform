// Mask secrets before anything is written to logs (port of crates/runtime/src/redact.rs).
const PATTERNS = [
  /(api[_-]?key|secret|token|password|bearer)\s*[:=]\s*\S{8,}/gi,
  /sk-[A-Za-z0-9]{16,}/gi,
  /bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

/** Redact every string inside a JSON-like value (keys are kept). */
export function redactValue<T>(v: T): T {
  if (typeof v === "string") return redact(v) as T;
  if (Array.isArray(v)) return v.map(redactValue) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactValue(x)])) as T;
  return v;
}
