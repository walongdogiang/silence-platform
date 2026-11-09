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
      onEvent: (cb: (payload: unknown) => void) => () => void;
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
    };
  }
}
