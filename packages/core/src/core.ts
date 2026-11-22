import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { RpcServer } from "./api/jsonrpc.js";
import { ClaudeBackend } from "./backends/claude/index.js";
import { AuditLog } from "./store/audit.js";
import { EventLog } from "./store/eventLog.js";
import { RepoApprovals } from "./repoConfig/review.js";
import { SessionManager, type SessionManagerOptions } from "./sessions/manager.js";
import { coreDataDir, silenceHome } from "./sessions/personal.js";

export const CORE_VERSION = "0.1.0";

export interface CoreOptions {
  /** Where the host runs, for diagnostics: "electron-utility", "node", "test". */
  host: string;
  /** Event log and audit directory (default `coreDataDir()`). */
  dataDir?: string;
  /** `~/.silence` (default `silenceHome()`). */
  home?: string;
  /** Overrides for tests: backends, external session listing, snapshots, ids. */
  sessions?: Partial<Omit<SessionManagerOptions, "log" | "audit" | "home" | "approvals">>;
}

export interface Core {
  server: RpcServer;
  sessions: SessionManager;
}

/**
 * Build the core RPC server. Methods are added here as each roadmap step lands
 * (risk, log, sessions, backends). The core never imports Electron.
 */
export function createCore(opts: CoreOptions): RpcServer {
  return createCoreWithSessions(opts).server;
}

export function createCoreWithSessions(opts: CoreOptions): Core {
  const startedAt = Date.now();
  const server = new RpcServer();
  const dataDir = opts.dataDir ?? coreDataDir();
  const sessions = new SessionManager({
    backends: opts.sessions?.backends ?? { claude: new ClaudeBackend() },
    listExternal: opts.sessions?.listExternal ?? ((o) => listSessions(o)),
    log: new EventLog(dataDir),
    audit: new AuditLog(dataDir),
    home: opts.home ?? silenceHome(),
    approvals: new RepoApprovals(dataDir),
    ...(opts.sessions?.snapshot ? { snapshot: opts.sessions.snapshot } : {}),
    ...(opts.sessions?.newId ? { newId: opts.sessions.newId } : {}),
  });
  server.register("core.ping", () => "pong");
  server.register("core.info", () => ({
    version: CORE_VERSION,
    host: opts.host,
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    platform: process.platform,
    pid: process.pid,
    uptimeMs: Date.now() - startedAt,
    dataDir,
    methods: server.methods(),
  }));
  server.register("session.create", (p, ctx) => sessions.create(p, ctx));
  server.register("session.prompt", (p, ctx) => sessions.prompt(p, ctx));
  server.register("session.abort", (p) => sessions.abort(p));
  server.register("session.permission", (p) => sessions.permission(p));
  server.register("session.set_mode", (p) => sessions.setMode(p));
  server.register("session.set_model", (p) => sessions.setModel(p));
  server.register("session.set_permission", (p) => sessions.setPermission(p));
  server.register("session.close", (p) => sessions.close(p));
  server.register("session.list", (p) => sessions.list(p));
  server.register("repo_config.review", (p) => sessions.reviewRepoConfig(p));
  server.register("repo_config.approve", (p) => sessions.approveRepoConfig(p));
  server.register("profile.status", (p) => sessions.profileStatus(p));
  server.register("permissions.rules", (p) => sessions.listRules(p));
  return { server, sessions };
}
