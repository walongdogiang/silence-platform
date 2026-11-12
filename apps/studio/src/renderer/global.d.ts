declare module "*.png" {
  const src: string;
  export default src;
}

export {};

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
      notifyPermission?: (reason: string) => Promise<boolean>;
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
