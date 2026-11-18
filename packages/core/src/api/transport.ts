import type { RpcMessage, Transport } from "./jsonrpc.js";

/**
 * Minimal shape shared by Electron's MessagePortMain and Node's worker MessagePort:
 * `postMessage`, an `on("message")` listener and `start()`.
 */
export interface PortLike {
  postMessage(msg: unknown): void;
  on(event: "message", cb: (e: unknown) => void): unknown;
  on(event: "close", cb: () => void): unknown;
  start?(): void;
}

/** Electron's MessagePortMain wraps the payload in `{ data }`; Node's MessagePort passes it directly. */
function unwrap(e: unknown): unknown {
  if (typeof e === "object" && e !== null && "data" in e && !("jsonrpc" in e)) return (e as { data: unknown }).data;
  return e;
}

export function portTransport(port: PortLike): Transport {
  const t: Transport = {
    send: (msg: RpcMessage) => port.postMessage(msg),
    onMessage: (cb) => {
      port.on("message", (e) => cb(unwrap(e)));
      port.start?.();
    },
    onClose: (cb) => {
      port.on("close", cb);
    },
  };
  return t;
}

/** Two transports wired to each other in memory (tests, and same-process hosting). */
export function memoryPair(): [Transport, Transport] {
  const make = () => {
    const subs: Array<(m: unknown) => void> = [];
    return { subs };
  };
  const a = make();
  const b = make();
  const deliver = (subs: Array<(m: unknown) => void>, msg: unknown) => queueMicrotask(() => subs.forEach((s) => s(structuredClone(msg))));
  return [
    { send: (m) => deliver(b.subs, m), onMessage: (cb) => void a.subs.push(cb) },
    { send: (m) => deliver(a.subs, m), onMessage: (cb) => void b.subs.push(cb) },
  ];
}
