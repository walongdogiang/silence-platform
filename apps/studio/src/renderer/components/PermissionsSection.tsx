import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** "edit:src/**" → { tool: "edit", scope: "src/**" }; "shell" → tool-wide. */
function describe(entry: string) {
  const i = entry.indexOf(":");
  if (i < 0) return { tool: entry, scope: "mọi lần gọi trong workspace" };
  const glob = entry.slice(i + 1);
  return { tool: entry.slice(0, i), scope: glob === "*" ? "chỉ file ở thư mục gốc" : glob };
}

/** Quyền đã "Nhớ" của workspace (đọc/xoá qua Engine; file .silence/permissions.json). */
export function PermissionsSection(props: { workspace: string }) {
  const [entries, setEntries] = useState<string[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!props.workspace) return;
    let live = true;
    setErr("");
    window.silence
      .rpc("permissions.list", { workspace: props.workspace })
      .then((r) => live && setEntries((r as { allow: string[] }).allow))
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [props.workspace]);

  async function revoke(entry: string) {
    try {
      const r = (await window.silence.rpc("permissions.revoke", {
        workspace: props.workspace,
        entry,
      })) as { allow: string[] };
      setEntries(r.allow);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="appear-sec">
      <h3>Quyền đã nhớ</h3>
      {!props.workspace ? (
        <p className="muted">Mở một workspace để xem.</p>
      ) : err ? (
        <p className="perm-error" role="alert">{err}</p>
      ) : entries === null ? (
        <p className="muted">Đang tải…</p>
      ) : entries.length === 0 ? (
        <p className="muted">Chưa nhớ quyền nào. Mọi thao tác ghi đều hỏi.</p>
      ) : (
        <ul className="perm-list">
          {entries.map((e) => {
            const d = describe(e);
            return (
              <li key={e}>
                <span>
                  <strong>{d.tool}</strong> · {d.scope}
                </span>
                <button type="button" className="icon-btn" aria-label={`Thu hồi ${e}`} title="Thu hồi" onClick={() => void revoke(e)}>
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
