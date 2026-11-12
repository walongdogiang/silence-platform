import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "./models";
import { needsHydrate } from "./imageStore";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  copyImageToClipboard,
  dataUrlToBlob,
  fitSize,
  imagesFromFiles,
  supportsImages,
  threadsForStorage,
  writePngToClipboard,
} from "./pastedImages";

const png = (bytes = 8) => new File([new Uint8Array(bytes)], "a.png", { type: "image/png" });

describe("imagesFromFiles", () => {
  it("đọc ảnh hợp lệ thành data URL", async () => {
    const r = await imagesFromFiles([png()], 0);
    expect(r.error).toBeUndefined();
    expect(r.images).toHaveLength(1);
    expect(r.images[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("bỏ ảnh sai loại, quá lớn, vượt số lượng", async () => {
    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" });
    expect((await imagesFromFiles([svg], 0)).images).toHaveLength(0);
    expect((await imagesFromFiles([png(MAX_IMAGE_BYTES + 1)], 0)).error).toMatch(/MB/);
    const r = await imagesFromFiles([png(), png()], MAX_IMAGES - 1);
    expect(r.images).toHaveLength(1);
    expect(r.error).toMatch(/Tối đa/);
  });
});

describe("threadsForStorage", () => {
  it("bỏ base64, giữ số ảnh", () => {
    const t: ChatThread = {
      id: "1",
      sessionId: "s",
      workspace: "w",
      title: "t",
      preview: "",
      updatedAt: 0,
      lines: [{ kind: "user", text: "xem", images: ["data:image/png;base64,AA", "data:image/png;base64,BB"] }],
    };
    const [out] = threadsForStorage([t]);
    expect(out.lines[0]).toEqual({ kind: "user", text: "xem", imageCount: 2 });
    expect(t.lines[0]).toHaveProperty("images");
  });
});

describe("fitSize", () => {
  it("giữ ảnh nhỏ, thu ảnh lớn theo cạnh dài", () => {
    expect(fitSize(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitSize(4096, 2160)).toEqual({ w: 2048, h: 1080 });
    expect(fitSize(1000, 5000, 2000)).toEqual({ w: 400, h: 2000 });
  });
});

describe("lịch sử giữ ảnh qua IndexedDB", () => {
  it("threadsForStorage giữ imageIds, bỏ base64", () => {
    const t: ChatThread = {
      id: "1",
      sessionId: "s",
      workspace: "w",
      title: "t",
      preview: "",
      updatedAt: 0,
      lines: [{ kind: "user", text: "a", images: ["data:image/png;base64,AA"], imageIds: ["h1"] }],
    };
    expect(threadsForStorage([t])[0].lines[0]).toEqual({ kind: "user", text: "a", imageIds: ["h1"], imageCount: 1 });
  });

  it("needsHydrate chỉ khi có id mà chưa có ảnh, bỏ qua id đã biết là mất", () => {
    expect(needsHydrate({ kind: "user", text: "", imageIds: ["h1"] })).toBe(true);
    expect(needsHydrate({ kind: "user", text: "", imageIds: ["h1"], images: ["x"] })).toBe(false);
    expect(needsHydrate({ kind: "user", text: "", imageIds: ["h1"] }, new Set(["h1"]))).toBe(false);
    expect(needsHydrate({ kind: "user", text: "" })).toBe(false);
  });
});

describe("supportsImages", () => {
  it("chỉ Engine protocol >= 0.1.7 nhận ảnh", () => {
    expect(supportsImages("0.1.6")).toBe(false);
    expect(supportsImages("0.1.7")).toBe(true);
    expect(supportsImages("0.2.0")).toBe(true);
    expect(supportsImages("0.1.10")).toBe(true);
    expect(supportsImages(undefined)).toBe(false);
    expect(supportsImages("dev")).toBe(false);
  });
});

describe("writePngToClipboard", () => {
  afterEach(() => vi.unstubAllGlobals());
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });

  it("trong app: ghi qua main process (window.silence.copyImage), không đụng Clipboard API của trang", async () => {
    const copyImage = vi.fn().mockResolvedValue(true);
    const write = vi.fn();
    vi.stubGlobal("window", { silence: { copyImage } });
    vi.stubGlobal("navigator", { clipboard: { write } });
    await writePngToClipboard(png);
    expect(copyImage).toHaveBeenCalledTimes(1);
    expect(Array.from(copyImage.mock.calls[0][0] as Uint8Array)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(write).not.toHaveBeenCalled();
  });

  it("main từ chối → ném lỗi để UI báo", async () => {
    vi.stubGlobal("window", { silence: { copyImage: vi.fn().mockResolvedValue(false) } });
    await expect(writePngToClipboard(png)).rejects.toThrow();
  });

  it("không có cầu nối (trình duyệt): dùng navigator.clipboard.write với image/png", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    class Item {
      constructor(public data: Record<string, Blob>) {}
    }
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { clipboard: { write } });
    vi.stubGlobal("ClipboardItem", Item);
    await writePngToClipboard(png);
    expect(write).toHaveBeenCalledTimes(1);
    expect(Object.keys((write.mock.calls[0][0][0] as Item).data)).toEqual(["image/png"]);
  });
});

describe("dataUrlToBlob", () => {
  it("giải mã base64 và utf-8 tại chỗ (không fetch: CSP chặn data: trong app)", async () => {
    const png = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
    expect(png.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await png.arrayBuffer()))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const svg = dataUrlToBlob("data:image/svg+xml;charset=utf-8,%3Csvg%3E%C3%A2%3C%2Fsvg%3E");
    expect(svg.type).toBe("image/svg+xml");
    expect(await svg.text()).toBe("<svg>â</svg>");
    expect(() => dataUrlToBlob("https://x/y.png")).toThrow();
  });
});

describe("copyImageToClipboard: bấm dồn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("bấm lại khi lần trước chưa xong thì dùng chung lần đó; xong rồi bấm lại thì copy lần mới", async () => {
    let finish: (ok: boolean) => void = () => {};
    const copyImage = vi.fn(() => new Promise<boolean>((r) => (finish = r)));
    vi.stubGlobal("window", { silence: { copyImage } });
    const url = "data:image/png;base64,iVBORw0KGgo=";
    const a = copyImageToClipboard(url);
    const b = copyImageToClipboard(url);
    expect(b).toBe(a);
    await vi.waitFor(() => expect(copyImage).toHaveBeenCalledTimes(1));
    finish(true);
    await Promise.all([a, b]);
    const c = copyImageToClipboard(url);
    expect(c).not.toBe(a);
    await vi.waitFor(() => expect(copyImage).toHaveBeenCalledTimes(2));
    finish(true);
    await c;
  });
});
