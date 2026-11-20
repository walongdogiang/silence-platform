// Append-only JSON Lines files with one writer per file (writes are serialised per path).
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const queues = new Map<string, Promise<void>>();

/** Append one record as a line. Calls for the same file run in order; each resolves after its write. */
export function appendJsonl(file: string, record: unknown): Promise<void> {
  const line = JSON.stringify(record) + "\n";
  const prev = queues.get(file) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, line, "utf8");
    });
  queues.set(file, next);
  void next.finally(() => {
    if (queues.get(file) === next) queues.delete(file);
  });
  return next;
}

/** Read all records; a broken last line (crash mid-write) is skipped, other broken lines throw. */
export async function readJsonl<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const out: T[] = [];
  lines.forEach((l, i) => {
    try {
      out.push(JSON.parse(l) as T);
    } catch (e) {
      if (i !== lines.length - 1) throw new Error(`${file}: line ${i + 1} is not valid JSON`);
    }
  });
  return out;
}
