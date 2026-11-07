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
      onEvent: (cb: (payload: unknown) => void) => () => void;
      window: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
    };
  }
}
