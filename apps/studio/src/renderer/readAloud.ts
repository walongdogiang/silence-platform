/**
 * Đọc to câu trả lời bằng Web Speech API của Chromium (giọng có sẵn trên máy: Windows SAPI…).
 * Chạy tại chỗ trong renderer — không gọi model, không gửi chữ đi đâu.
 * Mỗi lúc chỉ đọc **một** tin; đọc tin khác thì tin trước dừng. Chia câu thành khúc ngắn vì
 * Chromium hay cắt utterance dài giữa chừng.
 */
import { useSyncExternalStore } from "react";
import { stripMarkdown } from "./messageMenu";

export type SpeechStatus = "idle" | "speaking" | "paused";
type State = { id: string | null; status: SpeechStatus };

let state: State = { id: null, status: "idle" };
const listeners = new Set<() => void>();
/** Tăng mỗi lần bắt đầu / dừng: callback của lần đọc cũ thấy số khác thì bỏ qua. */
let run = 0;

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

const synth = (): SpeechSynthesis | null =>
  typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

/** Máy có Web Speech không (không có thì ẩn nút). */
export const canReadAloud = () => synth() != null && typeof SpeechSynthesisUtterance !== "undefined";

/** Chữ để đọc: bỏ khối code (đọc lên vô nghĩa), bỏ Markdown, URL, gọn khoảng trắng. */
export function speechText(markdown: string): string {
  const noCode = markdown.replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s{0,3}\1\s*$/gm, "\n");
  return stripMarkdown(noCode)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Tiếng Việt khi có chữ có dấu tiếng Việt, còn lại tiếng Anh. */
export function guessLang(text: string): "vi-VN" | "en-US" {
  return /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text) ? "vi-VN" : "en-US";
}

/** Chia theo câu / dòng rồi gộp lại thành khúc ≤ `max` ký tự (câu quá dài thì cắt theo dấu phẩy / khoảng trắng). */
export function speechChunks(text: string, max = 220): string[] {
  const pieces = text
    .split(/(?<=[.!?…:;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      if (s.length <= max) return [s];
      const out: string[] = [];
      let rest = s;
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf(" ", max));
        const at = cut > max / 3 ? cut + 1 : max;
        out.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) out.push(rest);
      return out;
    });
  const chunks: string[] = [];
  for (const p of pieces) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + 1 + p.length <= max) chunks[chunks.length - 1] = `${last} ${p}`;
    else chunks.push(p);
  }
  return chunks;
}

function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = synth()?.getVoices() ?? [];
  const base = lang.slice(0, 2).toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base));
}

/** Bắt đầu đọc tin `id` (dừng tin đang đọc). Trả `false` khi không đọc được (không có Web Speech / chữ rỗng). */
export function speak(id: string, markdown: string): boolean {
  const s = synth();
  const text = speechText(markdown);
  if (!s || !text) return false;
  s.cancel();
  const my = ++run;
  const lang = guessLang(text);
  const voice = voiceFor(lang);
  const chunks = speechChunks(text);
  let i = 0;
  const next = () => {
    if (my !== run) return;
    if (i >= chunks.length) {
      set({ id: null, status: "idle" });
      return;
    }
    const u = new SpeechSynthesisUtterance(chunks[i++]);
    u.lang = voice?.lang ?? lang;
    if (voice) u.voice = voice;
    u.onend = next;
    u.onerror = (e) => {
      if (my !== run) return;
      // "interrupted"/"canceled" = mình chủ động dừng; lỗi khác thì bỏ khúc này, đọc tiếp.
      if (e.error === "interrupted" || e.error === "canceled") return;
      next();
    };
    s.speak(u);
  };
  set({ id, status: "speaking" });
  next();
  return true;
}

export function pauseSpeech() {
  const s = synth();
  if (!s || state.status !== "speaking") return;
  s.pause();
  set({ ...state, status: "paused" });
}

export function resumeSpeech() {
  const s = synth();
  if (!s || state.status !== "paused") return;
  s.resume();
  set({ ...state, status: "speaking" });
}

export function stopSpeech() {
  run++;
  synth()?.cancel();
  if (state.status !== "idle") set({ id: null, status: "idle" });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Trạng thái đọc của tin `id` ("idle" khi đang đọc tin khác). */
export function useSpeechStatus(id: string): SpeechStatus {
  return useSyncExternalStore(
    subscribe,
    () => (state.id === id ? state.status : "idle"),
    () => "idle" as const,
  );
}
