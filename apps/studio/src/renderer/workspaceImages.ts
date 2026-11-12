import { parsePathRef } from "./pathRef";

/** Đuôi ảnh Studio xem trước được (khớp `image_mime` trong `crates/tools/src/image.rs`). */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

/** Ảnh trong workspace: `fs.read_image` (Engine giữ jail + giới hạn 5 MB). */
export type WorkspaceImageResult = { path: string; mime: string; bytes: number; data_url: string };

export async function readWorkspaceImage(workspace: string, path: string): Promise<WorkspaceImageResult> {
  return (await window.silence.rpc("fs.read_image", { workspace, path })) as WorkspaceImageResult;
}

/** `src` của ảnh Markdown là đường dẫn trong workspace (không scheme, không tuyệt đối, không `..`). */
export function workspaceImageSrc(src: string | undefined): string | null {
  if (!src) return null;
  const clean = src.replace(/^\.\//, "");
  const ref = parsePathRef(clean);
  return ref && isImagePath(ref.path) ? ref.path : null;
}

/**
 * Đường dẫn ảnh workspace được nhắc trong câu trả lời (chip `path`, link `[x](path)`, chữ trơn),
 * trừ ảnh đã nhúng bằng `![](path)` (đã hiện tại chỗ). Giữ thứ tự, bỏ trùng, tối đa `max`.
 */
export function imageRefsIn(text: string, max = 4): string[] {
  const embedded = new Set<string>();
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const p = workspaceImageSrc(m[1]);
    if (p) embedded.add(p);
  }
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|[\s`(\[])((?:\.\/)?[\w.\-]+(?:\/[\w.\-]+)*\.(?:png|jpe?g|gif|webp|svg))(?=$|[\s`)\],.:;!?])/gim)) {
    const p = workspaceImageSrc(m[1]);
    if (!p || embedded.has(p) || out.includes(p)) continue;
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
