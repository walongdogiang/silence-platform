// JSON-RPC 2.0 over any message transport (MessagePort today, WebSocket later).
// The core is the server; clients send requests and receive `session.event`-style notifications.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export interface RpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}
export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}
export interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: RpcError;
}
export type RpcMessage = RpcRequest | RpcNotification | RpcResponse;

export const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  Internal: -32603,
} as const;

/** Error a handler throws to answer with a specific JSON-RPC error code. */
export class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** One connected client. Messages are plain objects (structured clone), not strings. */
export interface Transport {
  send(msg: RpcMessage): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose?(cb: () => void): void;
}

/** Context a handler gets: the client it serves, so it can push notifications back. */
export interface CallContext {
  notify(method: string, params?: unknown): void;
}

export type Handler = (params: unknown, ctx: CallContext) => unknown | Promise<unknown>;

export function isRequest(m: unknown): m is RpcRequest {
  return typeof m === "object" && m !== null && (m as RpcRequest).jsonrpc === "2.0" && typeof (m as RpcRequest).method === "string" && "id" in m;
}

export class RpcServer {
  private readonly handlers = new Map<string, Handler>();

  register(method: string, handler: Handler): this {
    if (this.handlers.has(method)) throw new Error(`method already registered: ${method}`);
    this.handlers.set(method, handler);
    return this;
  }

  methods(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /** Serve one client over `transport`. Returns the context used to push notifications to it. */
  attach(transport: Transport): CallContext {
    const ctx: CallContext = { notify: (method, params) => transport.send({ jsonrpc: "2.0", method, params }) };
    transport.onMessage((raw) => {
      void this.dispatch(raw, ctx).then((res) => {
        if (res) transport.send(res);
      });
    });
    return ctx;
  }

  /** Handle one incoming message; returns the response, or null for notifications. */
  async dispatch(raw: unknown, ctx: CallContext): Promise<RpcResponse | null> {
    if (!isRequest(raw)) {
      const looksLikeNotification = typeof raw === "object" && raw !== null && typeof (raw as RpcNotification).method === "string";
      if (looksLikeNotification) return null; // client notifications are ignored for now
      return { jsonrpc: "2.0", id: null, error: { code: ErrorCodes.InvalidRequest, message: "invalid request" } };
    }
    const handler = this.handlers.get(raw.method);
    if (!handler) return { jsonrpc: "2.0", id: raw.id, error: { code: ErrorCodes.MethodNotFound, message: `method not found: ${raw.method}` } };
    try {
      const result = await handler(raw.params, ctx);
      return { jsonrpc: "2.0", id: raw.id, result: result ?? null };
    } catch (e) {
      if (e instanceof RpcFailure) return { jsonrpc: "2.0", id: raw.id, error: { code: e.code, message: e.message, data: e.data } };
      return { jsonrpc: "2.0", id: raw.id, error: { code: ErrorCodes.Internal, message: e instanceof Error ? e.message : String(e) } };
    }
  }
}

/** Client side: request/response correlation plus notification callbacks. */
export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Set<(method: string, params: unknown) => void>();

  constructor(private readonly transport: Transport) {
    transport.onMessage((raw) => this.receive(raw));
    transport.onClose?.(() => {
      for (const p of this.pending.values()) p.reject(new Error("core connection closed"));
      this.pending.clear();
    });
  }

  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.transport.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  onNotification(cb: (method: string, params: unknown) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private receive(raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return;
    const m = raw as RpcResponse & RpcNotification;
    if ("id" in m && m.id !== null && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!;
      this.pending.delete(m.id);
      if (m.error) p.reject(Object.assign(new Error(m.error.message), { code: m.error.code, data: m.error.data }));
      else p.resolve(m.result);
      return;
    }
    if (typeof m.method === "string") for (const l of this.listeners) l(m.method, m.params);
  }
}
