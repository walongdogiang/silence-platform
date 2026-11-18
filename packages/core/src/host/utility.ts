// Entry point when Studio starts the core with Electron's `utilityProcess.fork`.
// Studio posts `{ type: "connect" }` with a MessagePortMain; each port is one client.
// Runs as plain Node inside Electron; must not import "electron".
import { createCore } from "../core.js";
import { portTransport, type PortLike } from "../api/transport.js";

interface ParentPort {
  on(event: "message", cb: (e: { data: unknown; ports: PortLike[] }) => void): void;
  postMessage(msg: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) {
  console.error("[core] no parentPort: this entry must be started with utilityProcess.fork");
  process.exit(2);
}

const server = createCore({ host: "electron-utility" });

parentPort.on("message", (e) => {
  const msg = e.data as { type?: string } | undefined;
  if (msg?.type === "connect" && e.ports[0]) {
    server.attach(portTransport(e.ports[0]));
  }
});

parentPort.postMessage({ type: "ready", pid: process.pid });
