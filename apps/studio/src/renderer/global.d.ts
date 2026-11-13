declare module "*.png" {
  const src: string;
  export default src;
}

export {};

/** Studio version from package.json (electron.vite.config `define`). */
declare global {
  const __APP_VERSION__: string | undefined;
}

declare global {
  interface Window {
    silence: {
      rpc: (method: string, params?: unknown) => Promise<unknown>;
      pickFolder: () => Promise<string | null>;
      /** Mở http(s) bằng trình duyệt ngoài; main từ chối scheme khác. */
      openExternal: (url: string) => Promise<boolean>;
      /** Ghi PNG vào clipboard hệ thống (main process); main từ chối dữ liệu không phải PNG. */
      copyImage?: (png: Uint8Array) => Promise<boolean>;
      /** Thông báo desktop "cần bạn duyệt" (chỉ hiện khi cửa sổ không ở phía trước). Chỉ gửi lý do, không gửi lệnh. */
      notifyPermission?: (reason: string, opts?: { notify: boolean; flash: boolean }) => Promise<boolean>;
      /** Thông báo "agent xong" khi cửa sổ không ở phía trước. Chỉ gửi tên chat. */
      notifyDone?: (title: string, opts?: { notify: boolean; flash: boolean }) => Promise<boolean>;
      /** Gửi một thông báo mẫu (luôn hiện) từ Settings. */
      notifyTest?: (title: string, body: string) => Promise<boolean>;
      /** Giữ máy không ngủ trong lúc agent chạy (powerSaveBlocker ở main). */
      keepAwake?: (on: boolean) => Promise<boolean>;
      /** Mở thư mục dữ liệu của Engine trong Explorer (main tự lấy đường dẫn). */
      openDataDir?: () => Promise<boolean>;
      /** API key provider: lưu mã hoá ở main (safeStorage). Không bao giờ trả key về renderer. */
      credentials?: {
        status: () => Promise<Array<{ provider: string; has_key: boolean; last4: string }>>;
        set: (
          provider: string,
          key: string,
        ) => Promise<Array<{ provider: string; has_key: boolean; last4: string }>>;
      };
      onEvent: (cb: (payload: unknown) => void) => () => void;
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
    };
  }
}
