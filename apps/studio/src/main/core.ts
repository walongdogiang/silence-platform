// Start the TS harness core (packages/core, ADR 0004) in an Electron utility process and talk to it
// over a MessagePort. Behind the `SILENCE_CORE=1` switch until the core replaces the Rust Engine.
import { MessageChannelMain, utilityProcess, type UtilityProcess } from "electron";
import { createRequire } from "node:module";
import { RpcClient, portTransport, type PortLike } from "@silence/core";

export interface CoreHandle {
  client: RpcClient;
  stop(): void;
}

/** `SILENCE_CORE=1` turns the new core on; anything else keeps the old path only. */
export function coreEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SILENCE_CORE === "1";
}

/** Path of the built utility entry (`packages/core/dist/host/utility.js`). */
export function coreEntry(): string {
  return createRequire(import.meta.url).resolve("@silence/core/host/utility");
}

/**
 * Fork the core and connect one client port. Resolves once the core answered `core.ping`.
 * `onExit` fires if the core process ends on its own (not after `stop`).
 */
export async function startCore(onExit: (code: number) => void): Promise<CoreHandle> {
  const proc: UtilityProcess = utilityProcess.fork(coreEntry(), [], { serviceName: "5ilence core", stdio: "inherit" });
  let stopping = false;
  proc.on("exit", (code) => {
    if (!stopping) onExit(code);
  });

  const { port1, port2 } = new MessageChannelMain();
  proc.postMessage({ type: "connect" }, [port2]);
  const client = new RpcClient(portTransport(port1 as unknown as PortLike));

  const pong = await Promise.race([
    client.call<string>("core.ping"),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("core did not answer core.ping within 10s")), 10_000)),
  ]);
  if (pong !== "pong") throw new Error(`unexpected core.ping answer: ${String(pong)}`);

  return {
    client,
    stop: () => {
      stopping = true;
      port1.close();
      proc.kill();
    },
  };
}
