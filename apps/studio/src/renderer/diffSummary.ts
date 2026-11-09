export type DiffLine = { kind: "add" | "del"; text: string };
export type DiffSummary = { added: number; removed: number; lines: DiffLine[] };
export type DiffRow = { kind: "ctx" | "add" | "del"; text: string; oldNo?: number; newNo?: number };
export type DiffHunk = { rows: DiffRow[]; skippedBefore: number };

type Op = { kind: "eq" | "add" | "del"; text: string };

const LCS_LIMIT = 4_000_000;

function splitLines(s: string): string[] {
  if (s === "") return [];
  const xs = s.replace(/\r\n/g, "\n").split("\n");
  if (xs[xs.length - 1] === "") xs.pop();
  return xs;
}

/** Chuỗi op theo dòng trên toàn file (LCS sau khi cắt prefix/suffix chung). */
function lineOps(before: string, after: string): Op[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = a.slice(0, start).map((text) => ({ kind: "eq", text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);

  if (x.length * y.length > LCS_LIMIT) {
    for (const t of x) ops.push({ kind: "del", text: t });
    for (const t of y) ops.push({ kind: "add", text: t });
  } else {
    const n = x.length;
    const m = y.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) {
        ops.push({ kind: "eq", text: x[i] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ kind: "del", text: x[i++] });
      } else {
        ops.push({ kind: "add", text: y[j++] });
      }
    }
    while (i < n) ops.push({ kind: "del", text: x[i++] });
    while (j < m) ops.push({ kind: "add", text: y[j++] });
  }
  for (const t of a.slice(endA)) ops.push({ kind: "eq", text: t });
  return ops;
}

/** Tóm tắt thay đổi theo dòng (+N −M) và danh sách dòng đổi, không thêm dependency. */
export function summarizeDiff(before: string, after: string): DiffSummary {
  const lines = lineOps(before, after).filter((o): o is DiffLine => o.kind !== "eq");
  return {
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "del").length,
    lines,
  };
}

/** Diff unified chia hunk, mỗi hunk có `context` dòng không đổi hai bên và số dòng cũ/mới. */
export function diffHunks(before: string, after: string, context = 3): DiffHunk[] {
  const ops = lineOps(before, after);
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const o of ops) {
    if (o.kind === "eq") rows.push({ kind: "ctx", text: o.text, oldNo: ++oldNo, newNo: ++newNo });
    else if (o.kind === "del") rows.push({ kind: "del", text: o.text, oldNo: ++oldNo });
    else rows.push({ kind: "add", text: o.text, newNo: ++newNo });
  }
  const changed = rows.flatMap((r, i) => (r.kind === "ctx" ? [] : [i]));
  if (changed.length === 0) return [];

  // Gom các khoảng [from, to] quanh dòng đổi; khoảng chồng/liền nhau thì gộp.
  const ranges: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(0, i - context);
    const to = Math.min(rows.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  let prevEnd = -1;
  return ranges.map(([from, to]) => {
    const hunk = { rows: rows.slice(from, to + 1), skippedBefore: from - prevEnd - 1 };
    prevEnd = to;
    return hunk;
  });
}
