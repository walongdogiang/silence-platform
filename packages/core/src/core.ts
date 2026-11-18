import { RpcServer } from "./api/jsonrpc.js";

export const CORE_VERSION = "0.1.0";

export interface CoreOptions {
  /** Where the host runs, for diagnostics: "electron-utility", "node", "test". */
  host: string;
}

/**
 * Build the core RPC server. Methods are added here as each roadmap step lands
 * (risk, log, sessions, backends). The core never imports Electron.
 */
export function createCore(opts: CoreOptions): RpcServer {
  const startedAt = Date.now();
  const server = new RpcServer();
  server.register("core.ping", () => "pong");
  server.register("core.info", () => ({
    version: CORE_VERSION,
    host: opts.host,
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    platform: process.platform,
    pid: process.pid,
    uptimeMs: Date.now() - startedAt,
    methods: server.methods(),
  }));
  return server;
}
