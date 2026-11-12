/**
 * Ảnh dán của lịch sử chat, lưu IndexedDB (localStorage chỉ ~5 MB nên không chứa base64).
 * Key = SHA-256 hex của data URL, nên cùng một ảnh chỉ lưu một lần.
 * Mọi lỗi (IndexedDB bị tắt, hết quota) đều nuốt: lịch sử rơi về "N ảnh".
 */
import type { ChatLine, ChatThread } from "./models";

const DB = "silence-images";
const STORE = "images";

let dbPromise: Promise<IDBDatabase> | null = null;
/** Id vừa lưu trong phiên này: `pruneImages` không xoá (tin mới có thể chưa kịp vào lịch sử). */
const pinned = new Set<string>();

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function imageId(dataUrl: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lưu ảnh, trả id theo đúng thứ tự. Lỗi → `null`. */
export async function putImages(urls: string[]): Promise<string[] | null> {
  try {
    const ids = await Promise.all(urls.map(imageId));
    ids.forEach((id) => pinned.add(id));
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    urls.forEach((u, i) => store.put(u, ids[i]));
    await done(tx);
    return ids;
  } catch {
    return null;
  }
}

/** Ảnh theo id; id không còn → `undefined` ở vị trí đó. */
export async function getImages(ids: string[]): Promise<(string | undefined)[]> {
  try {
    const db = await openDb();
    const store = db.transaction(STORE, "readonly").objectStore(STORE);
    return await Promise.all(
      ids.map(
        (id) =>
          new Promise<string | undefined>((resolve) => {
            const req = store.get(id);
            req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : undefined);
            req.onerror = () => resolve(undefined);
          }),
      ),
    );
  } catch {
    return ids.map(() => undefined);
  }
}

/** Xoá ảnh không còn thread nào trỏ tới (thread đã xoá). */
export async function pruneImages(keep: Set<string>): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const k of req.result) {
        if (typeof k === "string" && !keep.has(k) && !pinned.has(k)) store.delete(k);
      }
    };
    await done(tx);
  } catch {
    // Không dọn được thì để lần sau.
  }
}

/** Mọi id ảnh mà lịch sử còn dùng. */
export function referencedImageIds(threads: ChatThread[]): Set<string> {
  const ids = new Set<string>();
  for (const t of threads) {
    for (const l of t.lines) {
      if (l.kind === "user") l.imageIds?.forEach((id) => ids.add(id));
    }
  }
  return ids;
}

/** Dòng user có `imageIds` nhưng chưa có ảnh trong bộ nhớ (mở lại từ lịch sử). */
export function needsHydrate(l: ChatLine, skip?: Set<string>): boolean {
  return (
    l.kind === "user" &&
    Boolean(l.imageIds?.length) &&
    !l.images?.length &&
    !(skip && l.imageIds!.every((id) => skip.has(id)))
  );
}

/**
 * Điền lại `images` cho dòng user có `imageIds`. Không lấy được gì → trả đúng mảng cũ
 * (để caller không setState vô ích). `missed` nhận các id không còn trong IndexedDB.
 */
export async function hydrateImages(lines: ChatLine[], missed?: Set<string>): Promise<ChatLine[]> {
  if (!lines.some((l) => needsHydrate(l, missed))) return lines;
  let changed = false;
  const next = await Promise.all(
    lines.map(async (l) => {
      if (l.kind !== "user" || !needsHydrate(l, missed)) return l;
      const ids = l.imageIds!;
      const got = await getImages(ids);
      ids.forEach((id, i) => {
        if (!got[i]) missed?.add(id);
      });
      const images = got.filter((x): x is string => Boolean(x));
      if (!images.length) return l;
      changed = true;
      return { ...l, images };
    }),
  );
  return changed ? next : lines;
}
