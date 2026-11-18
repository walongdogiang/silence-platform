import { describe, expect, it } from "vitest";
import { ErrorCodes, RpcClient, RpcFailure, RpcServer } from "./jsonrpc.js";
import { memoryPair, portTransport, type PortLike } from "./transport.js";
import { createCore } from "../core.js";

function connect(server: RpcServer) {
  const [serverSide, clientSide] = memoryPair();
  const ctx = server.attach(serverSide);
  return { client: new RpcClient(clientSide), ctx };
}

describe("RpcServer / RpcClient", () => {
  it("answers a request", async () => {
    const s = new RpcServer().register("add", (p) => {
      const { a, b } = p as { a: number; b: number };
      return a + b;
    });
    const { client } = connect(s);
    await expect(client.call("add", { a: 2, b: 3 })).resolves.toBe(5);
  });

  it("returns method-not-found as a rejected call with the code", async () => {
    const { client } = connect(new RpcServer());
    await expect(client.call("nope")).rejects.toMatchObject({ code: ErrorCodes.MethodNotFound });
  });

  it("maps RpcFailure to its code and other errors to Internal", async () => {
    const s = new RpcServer()
      .register("bad", () => {
        throw new RpcFailure(ErrorCodes.InvalidParams, "x is required");
      })
      .register("boom", async () => {
        throw new Error("kaput");
      });
    const { client } = connect(s);
    await expect(client.call("bad")).rejects.toMatchObject({ code: ErrorCodes.InvalidParams, message: "x is required" });
    await expect(client.call("boom")).rejects.toMatchObject({ code: ErrorCodes.Internal, message: "kaput" });
  });

  it("delivers notifications pushed by a handler", async () => {
    const s = new RpcServer().register("start", (_p, ctx) => {
      ctx.notify("session.event", { type: "text.delta", text: "hi" });
      return "ok";
    });
    const { client } = connect(s);
    const got: Array<[string, unknown]> = [];
    client.onNotification((m, p) => got.push([m, p]));
    await client.call("start");
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([["session.event", { type: "text.delta", text: "hi" }]]);
  });

  it("rejects duplicate registration", () => {
    const s = new RpcServer().register("a", () => 1);
    expect(() => s.register("a", () => 2)).toThrow(/already registered/);
  });

  it("answers invalid requests and ignores client notifications", async () => {
    const s = new RpcServer();
    const ctx = { notify: () => {} };
    await expect(s.dispatch({ foo: 1 }, ctx)).resolves.toMatchObject({ error: { code: ErrorCodes.InvalidRequest } });
    await expect(s.dispatch({ jsonrpc: "2.0", method: "x" }, ctx)).resolves.toBeNull();
  });
});

describe("portTransport", () => {
  it("unwraps Electron-style { data } events and passes plain ones through", () => {
    const listeners: Array<(e: unknown) => void> = [];
    const sent: unknown[] = [];
    const port: PortLike = {
      postMessage: (m) => sent.push(m),
      on: (ev: string, cb: (e: unknown) => void) => {
        if (ev === "message") listeners.push(cb);
        return undefined;
      },
      start: () => {},
    };
    const t = portTransport(port);
    const got: unknown[] = [];
    t.onMessage((m) => got.push(m));
    listeners[0]!({ data: { jsonrpc: "2.0", id: 1, method: "a" } });
    listeners[0]!({ jsonrpc: "2.0", id: 2, method: "b" });
    expect(got).toEqual([
      { jsonrpc: "2.0", id: 1, method: "a" },
      { jsonrpc: "2.0", id: 2, method: "b" },
    ]);
    t.send({ jsonrpc: "2.0", id: 1, result: null });
    expect(sent).toHaveLength(1);
  });
});

describe("createCore", () => {
  it("serves ping and info", async () => {
    const { client } = connect(createCore({ host: "test" }));
    await expect(client.call("core.ping")).resolves.toBe("pong");
    const info = await client.call<{ host: string; methods: string[] }>("core.info");
    expect(info.host).toBe("test");
    expect(info.methods).toEqual(["core.info", "core.ping"]);
  });
});
