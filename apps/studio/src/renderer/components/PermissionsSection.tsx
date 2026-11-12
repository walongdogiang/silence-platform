import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PERM_MODES, type UiPermMode } from "../permissionUi";

/** "edit:src/**" → { tool: "edit", scope: "src/**" }; "shell" → tool-wide. */
function describe(entry: string) {
  const i = entry.indexOf(":");
  if (i < 0) return { tool: entry, scope: "mọi lần gọi trong workspace" };
  const tool = entry.slice(0, i);
  const glob = entry.slice(i + 1);
  // shell: mẫu lệnh (`npm install *`); file tool: glob thư mục.
  if (tool === "shell") return { tool, scope: `lệnh "${glob}"` };
  return { tool, scope: glob === "*" ? "chỉ file ở thư mục gốc" : glob };
}

/** Chế độ quyền: Cân bằng hoặc Thận trọng. Tự chủ chờ sandbox chặn mạng nên chưa chọn được. */
function PermissionModePicker(props: { mode: UiPermMode; onMode: (m: UiPermMode) => void }) {
  return (
    <div className="perm-modes" role="radiogroup" aria-label="Chế độ quyền của agent">
      {PERM_MODES.map((m) => (
        <label key={m.id} className={`perm-mode${props.mode === m.id ? " on" : ""}`}>
          <input
            type="radio"
            name="perm-mode"
            checked={props.mode === m.id}
            onChange={() => props.onMode(m.id)}
          />
          <span>
            <strong>{m.label}</strong>
            <em>{m.desc}</em>
          </span>
        </label>
      ))}
      <label className="perm-mode disabled" title="Cần sandbox chặn mạng trên Windows (chưa có)">
        <input type="radio" name="perm-mode" disabled />
        <span>
          <strong>Tự chủ</strong>
          <em>Chưa có: cần sandbox chặn mạng để tự chạy cả lệnh cần mạng một cách an toàn.</em>
        </span>
      </label>
    </div>
  );
}

/** Chế độ quyền + quyền đã "Nhớ" của workspace (đọc/xoá qua Engine; file .silence/permissions.json). */
export function PermissionsSection(props: { workspace: string; mode: UiPermMode; onMode: (m: UiPermMode) => void }) {
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
      <h3>Chế độ quyền</h3>
      <PermissionModePicker mode={props.mode} onMode={props.onMode} />
      <h3>Quyền đã nhớ</h3>
      {!props.workspace ? (
        <p className="muted">Mở một workspace để xem.</p>
      ) : err ? (
        <p className="perm-error" role="alert">{err}</p>
      ) : entries === null ? (
        <p className="muted">Đang tải…</p>
      ) : entries.length === 0 ? (
        <p className="muted">Chưa nhớ quyền nào. Hành động rủi ro luôn hỏi.</p>
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
