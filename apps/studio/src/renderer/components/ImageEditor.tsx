import {
  ArrowLeft,
  Brush,
  Copy,
  Download,
  Eraser,
  MessageSquarePlus,
  MoveUpRight,
  Redo2,
  Scissors,
  Send,
  Square,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import {
  copyBlob,
  downloadBlob,
  fileNameFor,
  flattenImage,
  imageSize,
  isSvgDataUrl,
  type EditTarget,
} from "../imageActions";
import {
  DEFAULT_COLOR,
  EDIT_COLORS,
  editPrompt,
  editReducer,
  emptyHistory,
  markSizes,
  markSvg,
  marksToSvg,
  pinsOf,
  simplify,
  toImagePoint,
  type Mark,
  type Pt,
  type Tool,
} from "../imageEdit";
import { useT, type MsgKey } from "../i18n";
import { ConfirmDialog } from "./ConfirmDialog";

const TOOLS: { id: Tool; label: MsgKey; icon: typeof Brush; hint: MsgKey }[] = [
  { id: "draw", label: "ie.draw", icon: Brush, hint: "ie.drawHint" },
  { id: "text", label: "ie.text", icon: Type, hint: "ie.textHint" },
  { id: "rect", label: "ie.rect", icon: Square, hint: "ie.rectHint" },
  { id: "arrow", label: "ie.arrow", icon: MoveUpRight, hint: "ie.arrowHint" },
  { id: "pin", label: "ie.pin", icon: MessageSquarePlus, hint: "ie.pinHint" },
];

let seq = 0;
const newId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Trình chỉnh sửa ảnh toàn màn hình (như app ảnh): đánh dấu lên ảnh (Phác hoạ, Văn bản, Khung,
 * Mũi tên, Bình luận ghim số), Undo/Redo, Copy/Tải PNG đã đánh dấu, và **Gửi cho agent**: đính
 * PNG vào composer + điền sẵn prompt (user tự gửi). Gỡ nền / Xóa vật thể cần model sửa ảnh —
 * hiện nhưng "chưa gắn". Renderer không gọi model: mọi thứ vẽ trên canvas tại chỗ.
 */
export function ImageEditor(props: {
  target: EditTarget;
  onClose: () => void;
  /** Đính ảnh + prompt vào composer. Trả lỗi (ngôn ngữ UI) nếu không đính được. */
  onSend: (png: Blob, prompt: string) => Promise<string | null>;
}) {
  const tr = useT();
  const { src, title, path } = props.target;
  const isSvg = isSvgDataUrl(src);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hist, dispatch] = useReducer(editReducer, undefined, emptyHistory);
  const [tool, setTool] = useState<Tool>("draw");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [focusPin, setFocusPin] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pinInputs = useRef(new Map<string, HTMLInputElement>());
  const closeRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const marks = hist.present;
  const dirty = marks.length > 0;
  const pins = pinsOf(marks);

  useEffect(() => {
    let alive = true;
    imageSize(src).then(
      (s) => alive && setSize(s),
      () => alive && setSize({ w: 800, h: 600 }),
    );
    return () => {
      alive = false;
    };
  }, [src]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Tỉ lệ hiển thị / ảnh gốc: để ô gõ chữ có cỡ đúng như chữ sẽ vẽ.
  useLayoutEffect(() => {
    const el = svgRef.current;
    if (!el || !size) return;
    const update = () => setScale(el.getBoundingClientRect().width / size.w || 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  useEffect(() => {
    if (!focusPin) return;
    // Focus ngay sau commit (ô đã có trong DOM); mousedown trên lớp vẽ đã bị chặn nên không bị cướp focus.
    pinInputs.current.get(focusPin)?.focus();
    setFocusPin(null);
  }, [focusPin]);

  useEffect(() => {
    if (editingText) textRef.current?.focus();
  }, [editingText]);

  function requestClose() {
    if (dirty) {
      setAskDiscard(true);
      return;
    }
    props.onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Hộp xác nhận đang mở: nó tự lo Esc / Tab, editor đứng yên.
      if (askDiscard) return;
      const t = e.target as HTMLElement | null;
      const typing = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA";
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (typing) {
          t?.blur();
          return;
        }
        requestClose();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        dispatch({ type: "remove", id: selected });
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!size) {
    return (
      <div className="ie" role="dialog" aria-modal="true" aria-label={tr("ie.title")}>
        <div className="ie-loading">{tr("ie.opening")}</div>
      </div>
    );
  }
  const sz = markSizes(size.w, size.h);

  function point(e: RPointerEvent): Pt {
    return toImagePoint(e.clientX, e.clientY, svgRef.current!.getBoundingClientRect(), size!);
  }

  function hitId(e: RPointerEvent, kinds: Mark["kind"][]): string | null {
    const id = (e.target as Element).closest?.("[data-id]")?.getAttribute("data-id") ?? null;
    const m = id ? marks.find((x) => x.id === id) : undefined;
    return m && kinds.includes(m.kind) ? m.id : null;
  }

  function onDown(e: RPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    // mousedown bị chặn nên ô chữ đang gõ không tự blur: chốt nó trước.
    if (editingText) finishText(editingText);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const p = point(e);
    if (tool === "text") {
      const hit = hitId(e, ["text"]);
      if (hit) {
        setSelected(hit);
        setEditingText(hit);
        return;
      }
      const id = newId();
      dispatch({ type: "add", mark: { id, kind: "text", color, size: sz.text, at: p, text: "" } });
      setSelected(id);
      setEditingText(id);
      e.preventDefault();
      return;
    }
    if (tool === "pin") {
      const hit = hitId(e, ["pin"]);
      const id = hit ?? newId();
      if (!hit) dispatch({ type: "add", mark: { id, kind: "pin", color, size: sz.pin, at: p, note: "" } });
      setSelected(id);
      setFocusPin(id);
      e.preventDefault();
      return;
    }
    setSelected(hitId(e, ["stroke", "rect", "arrow", "text", "pin"]));
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const id = newId();
    if (tool === "draw") setDraft({ id, kind: "stroke", color, width: sz.stroke, points: [p] });
    else setDraft({ id, kind: tool, color, width: sz.stroke, a: p, b: p });
  }

  function onMove(e: RPointerEvent<SVGSVGElement>) {
    if (!draft) return;
    const p = point(e);
    if (draft.kind === "stroke") setDraft({ ...draft, points: [...draft.points, p] });
    else if (draft.kind === "rect" || draft.kind === "arrow") setDraft({ ...draft, b: p });
  }

  function onUp() {
    if (!draft) return;
    if (draft.kind === "stroke") {
      dispatch({ type: "add", mark: { ...draft, points: simplify(draft.points, Math.max(1, draft.width * 0.5)) } });
    } else if (draft.kind === "rect" || draft.kind === "arrow") {
      if (Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) > sz.stroke * 2) dispatch({ type: "add", mark: draft });
    }
    setDraft(null);
  }

  function finishText(id: string) {
    const m = marks.find((x) => x.id === id);
    if (m && m.kind === "text" && !m.text.trim()) dispatch({ type: "remove", id });
    setEditingText(null);
  }

  async function flatten(): Promise<Blob> {
    return flattenImage(src, marksToSvg(marks, size!.w, size!.h), size!);
  }

  async function run(failed: MsgKey, fn: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
    } catch {
      setStatus(tr(failed));
    } finally {
      setBusy(false);
    }
  }

  const pngName = fileNameFor(src, { path, name: title, ext: "png" }).replace(/\.png$/, "-annotated.png");
  const editing = editingText ? marks.find((m) => m.id === editingText && m.kind === "text") : undefined;
  let pinN = 0;

  return (
    <div className="ie" role="dialog" aria-modal="true" aria-label={tr("ie.title")}>
      <div className="ie-top">
        <button ref={closeRef} type="button" className="ie-icon" onClick={requestClose} title={tr("img.closeEsc")} aria-label={tr("common.close")}>
          <ArrowLeft size={18} />
        </button>
        <span className="ie-title" title={title ?? path}>
          {title ?? path ?? tr("ie.title")}
        </span>
        {status ? (
          <span className="ie-status" role="status">
            {status}
          </span>
        ) : null}
        <span className="ie-spacer" />
        <button type="button" className="ie-icon" disabled={!hist.past.length} onClick={() => dispatch({ type: "undo" })} title={tr("ie.undoKey")} aria-label={tr("diff.undo")}>
          <Undo2 size={17} />
        </button>
        <button type="button" className="ie-icon" disabled={!hist.future.length} onClick={() => dispatch({ type: "redo" })} title={tr("ie.redoKey")} aria-label={tr("ie.redo")}>
          <Redo2 size={17} />
        </button>
        <button
          type="button"
          className="ie-icon"
          disabled={busy}
          onClick={() => void run("ie.copyFailed", async () => {
            await copyBlob(await flatten());
            setStatus(tr("ie.copied"));
          })}
          title={tr("ie.copy")}
          aria-label={tr("ie.copy")}
        >
          <Copy size={17} />
        </button>
        <button
          type="button"
          className="ie-icon"
          disabled={busy}
          onClick={() => void run("ie.downloadFailed", async () => downloadBlob(await flatten(), pngName))}
          title={tr("ie.download")}
          aria-label={tr("ie.download")}
        >
          <Download size={17} />
        </button>
        <button
          type="button"
          className="ie-primary"
          disabled={busy}
          onClick={() => void run("ie.attachFailed", async () => {
            const err = await props.onSend(
              await flatten(),
              editPrompt({ title, path, isSvg, pins: pins.map((p) => ({ at: p.at, note: p.note })) }, tr),
            );
            if (err) setStatus(err);
            else props.onClose();
          })}
          title={tr("ie.sendTip")}
        >
          <Send size={15} />
          <span>{tr("ie.send")}</span>
        </button>
      </div>

      <div className="ie-main">
        <div className="ie-stage" ref={stageRef}>
          <div
            className="ie-canvas"
            style={{ aspectRatio: `${size.w} / ${size.h}`, width: `min(100%, calc((100vh - 230px) * ${size.w / size.h}))` }}
          >
            <img src={src} alt={title ?? path ?? tr("ie.image")} draggable={false} />
            <svg
              ref={svgRef}
              className={`ie-overlay tool-${tool}`}
              viewBox={`0 0 ${size.w} ${size.h}`}
              // Mặc định của mousedown làm mất focus ô chữ / ô ghi chú vừa mở → chặn.
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              {marks.map((m) => {
                const n = m.kind === "pin" ? ++pinN : 0;
                if (m.id === editingText) return null;
                return (
                  <g
                    key={m.id}
                    data-id={m.id}
                    className={m.id === selected ? "ie-sel" : undefined}
                    // Chuỗi do `markSvg` dựng: chữ đã escape, màu lấy từ bảng màu cố định.
                    dangerouslySetInnerHTML={{ __html: markSvg(m, n) }}
                  />
                );
              })}
              {draft ? <g dangerouslySetInnerHTML={{ __html: markSvg(draft) }} /> : null}
            </svg>
            {editing && editing.kind === "text" ? (
              <textarea
                ref={textRef}
                className="ie-text-input"
                rows={1}
                placeholder={tr("ie.textPlaceholder")}
                value={editing.text}
                style={{
                  left: `${(editing.at.x / size.w) * 100}%`,
                  top: `${(editing.at.y / size.h) * 100}%`,
                  color: editing.color,
                  fontSize: `${editing.size * scale}px`,
                }}
                onChange={(e) => dispatch({ type: "update", id: editing.id, patch: { text: e.target.value }, coalesce: true })}
                onBlur={() => finishText(editing.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.target as HTMLTextAreaElement).blur();
                  }
                }}
              />
            ) : null}
          </div>
        </div>

        {pins.length ? (
          <aside className="ie-notes" aria-label={tr("ie.pin")}>
            <div className="ie-notes-head">{tr("ie.pinsCount", { n: pins.length })}</div>
            {pins.map((p, i) => (
              <div key={p.id} className={`ie-note${p.id === selected ? " sel" : ""}`}>
                <span className="ie-note-n" style={{ background: p.color }}>
                  {i + 1}
                </span>
                <input
                  ref={(el) => {
                    if (el) pinInputs.current.set(p.id, el);
                    else pinInputs.current.delete(p.id);
                  }}
                  value={p.note}
                  placeholder={tr("ie.pinPlaceholder")}
                  onFocus={() => setSelected(p.id)}
                  onChange={(e) => dispatch({ type: "update", id: p.id, patch: { note: e.target.value }, coalesce: true })}
                />
                <button
                  type="button"
                  className="ie-icon sm"
                  onClick={() => dispatch({ type: "remove", id: p.id })}
                  title={tr("ie.removePin")}
                  aria-label={tr("ie.removePinN", { n: i + 1 })}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </aside>
        ) : null}
      </div>

      <div className="ie-bottom">
        <div className="ie-colors" role="radiogroup" aria-label={tr("ie.color")}>
          {EDIT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={tr("ie.colorN", { c })}
              className={`ie-color${c === color ? " on" : ""}`}
              style={{ background: c }}
              onClick={() => {
                setColor(c);
                if (selected) dispatch({ type: "update", id: selected, patch: { color: c } });
              }}
            />
          ))}
        </div>
        <div className="ie-tools" role="toolbar" aria-label={tr("ie.tools")}>
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ie-tool${t.id === tool ? " on" : ""}`}
              aria-pressed={t.id === tool}
              title={tr(t.hint)}
              onClick={() => setTool(t.id)}
            >
              <span className="ie-tool-ico">
                <t.icon size={18} />
              </span>
              <span>{tr(t.label)}</span>
            </button>
          ))}
          <span className="ie-tools-sep" aria-hidden />
          <button type="button" className="ie-tool" disabled title={tr("ie.noEditModel")}>
            <span className="ie-tool-ico">
              <Scissors size={18} />
            </span>
            <span>{tr("ie.removeBg")}</span>
            <em>{tr("common.notWired")}</em>
          </button>
          <button type="button" className="ie-tool" disabled title={tr("ie.noEditModel")}>
            <span className="ie-tool-ico">
              <Eraser size={18} />
            </span>
            <span>{tr("ie.eraseObject")}</span>
            <em>{tr("common.notWired")}</em>
          </button>
        </div>
      </div>
      {askDiscard ? (
        <ConfirmDialog
          title={tr("ie.discardTitle")}
          body={tr("ie.discardConfirm")}
          confirmLabel={tr("ie.discardDo")}
          danger
          onResult={(ok) => {
            setAskDiscard(false);
            if (ok) props.onClose();
          }}
        />
      ) : null}
    </div>
  );
}
