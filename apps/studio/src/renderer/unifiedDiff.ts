import type { DiffHunk, DiffRow } from "./diffSummary";

export type ParsedDiff = { path?: string; hunks: DiffHunk[]; added: number; removed: number };

/** Khối code có phải unified diff không (theo tên fence hoặc nội dung). */
export function looksLikeDiff(lang: string | undefined, text: string): boolean {
  const l = (lang ?? "").toLowerCase();
  if (l === "diff" || l === "patch") return true;
  if (/^@@ -\d+/m.test(text)) return true;
  return /^--- \S/m.test(text) && /^\+\+\+ \S/m.test(text);
}

function cleanPath(raw: string): string | undefined {
  const p = raw.trim().split("\t")[0].trim();
  if (!p || p === "/dev/null") return undefined;
  return p.replace(/^[ab]\//, "");
}

/**
 * Parse unified diff do model viết trong câu trả lời. Bỏ `diff --git`, `index`, `---`, `+++`;
 * `@@ -a,b +c,d @@` dùng để đánh số dòng. Không có dòng +/− nào thì trả `null`.
 */
export function parseUnifiedDiff(text: string): ParsedDiff | null {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  let oldPath: string | undefined;
  let newPath: string | undefined;
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let oldNo: number | undefined;
  let newNo: number | undefined;
  let lastOldEnd: number | undefined;
  let added = 0;
  let removed = 0;

  const ensureHunk = () => {
    if (!cur) {
      cur = { rows: [], skippedBefore: 0 };
      hunks.push(cur);
    }
    return cur;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ")) continue;
    if (line.startsWith("--- ") && !cur?.rows.length) {
      oldPath = cleanPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ") && !cur?.rows.length) {
      newPath = cleanPath(line.slice(4));
      continue;
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h) {
      const start = Number(h[1]);
      oldNo = start;
      newNo = Number(h[3]);
      const skipped = lastOldEnd === undefined ? Math.max(0, start - 1) : Math.max(0, start - lastOldEnd);
      cur = { rows: [], skippedBefore: skipped };
      hunks.push(cur);
      continue;
    }
    if (line.startsWith("\\")) continue;
    const hunk = ensureHunk();
    const sign = line[0];
    const body = line.slice(1);
    let row: DiffRow;
    if (sign === "-") {
      row = { kind: "del", text: body, oldNo };
      removed++;
      if (oldNo !== undefined) oldNo++;
    } else if (sign === "+") {
      row = { kind: "add", text: body, newNo };
      added++;
      if (newNo !== undefined) newNo++;
    } else {
      row = { kind: "ctx", text: sign === " " ? body : line, oldNo, newNo };
      if (oldNo !== undefined) oldNo++;
      if (newNo !== undefined) newNo++;
    }
    if (row.oldNo === undefined) delete row.oldNo;
    if (row.newNo === undefined) delete row.newNo;
    hunk.rows.push(row);
    if (oldNo !== undefined) lastOldEnd = oldNo;
  }

  if (added + removed === 0) return null;
  return { path: newPath ?? oldPath, hunks: hunks.filter((x) => x.rows.length > 0), added, removed };
}

const WORD = /[\p{L}\p{N}_]/u;

/** Nới vùng [s, e) ra tới ranh giới từ để tô cả `10`/`120` thay vì chỉ `2`. */
function toWord(t: string, s: number, e: number): [number, number] {
  while (s > 0 && WORD.test(t[s - 1])) s--;
  while (e < t.length && WORD.test(t[e])) e++;
  return [s, e];
}

/**
 * Vùng chữ thực sự đổi trong cặp dòng xoá/thêm liền nhau (theo chỉ số hàng trong `rows`).
 * Chỉ ghép khi khối xoá và khối thêm liền nhau có cùng số dòng; vùng đổi > 80% dòng thì bỏ.
 */
export function inlineChanges(rows: DiffRow[]): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  let i = 0;
  while (i < rows.length) {
    if (rows[i].kind !== "del") {
      i++;
      continue;
    }
    const delStart = i;
    while (i < rows.length && rows[i].kind === "del") i++;
    const addStart = i;
    while (i < rows.length && rows[i].kind === "add") i++;
    const n = addStart - delStart;
    if (n === 0 || i - addStart !== n) continue;
    for (let k = 0; k < n; k++) {
      const a = rows[delStart + k].text;
      const b = rows[addStart + k].text;
      let p = 0;
      while (p < a.length && p < b.length && a[p] === b[p]) p++;
      let s = 0;
      while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
      const ra = toWord(a, p, a.length - s);
      const rb = toWord(b, p, b.length - s);
      const tooBig = (r: [number, number], len: number) => len > 0 && (r[1] - r[0]) / len > 0.8;
      if (tooBig(ra, a.length) || tooBig(rb, b.length)) continue;
      if (ra[1] > ra[0]) out.set(delStart + k, ra);
      if (rb[1] > rb[0]) out.set(addStart + k, rb);
    }
  }
  return out;
}
