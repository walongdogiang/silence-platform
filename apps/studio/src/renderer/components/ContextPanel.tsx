import { Hexagon } from "lucide-react";
import { useState } from "react";
import mountains from "../assets/wallpapers/mountains.webp";
import type { ModelInfo } from "../types";

export function ContextPanel(props: {
  hidden: boolean;
  wsName: string;
  workspace: string;
  model: string;
  models: ModelInfo[];
  sessionId: string;
  costUsd: number;
  mcpName: string;
  mcpCmd: string;
  mcpArgs: string;
  onMcpName: (v: string) => void;
  onMcpCmd: (v: string) => void;
  onMcpArgs: (v: string) => void;
  onConnectMcp: () => void;
}) {
  const [tasks, setTasks] = useState([
    { id: "t1", title: "Design authentication flow", done: false, who: "AI" },
    { id: "t2", title: "Implement email/password", done: false, who: "AI" },
    { id: "t3", title: "Add tests (demo)", done: false, who: "AI" },
  ]);

  if (props.hidden) return null;

  return (
    <aside className="context">
      <section className="card">
        <div className="card-banner" style={{ backgroundImage: `url(${mountains})` }} />
        <div className="card-h">
          <b>Project Overview</b>
        </div>
        <p>{props.wsName || "Chưa mở workspace"} — local-first agent workbench.</p>
        <div className="chips">
          <span className="chip">Desktop</span>
          <span className="chip">TypeScript</span>
          <span className="chip">Electron</span>
          <span className="chip">Rust</span>
        </div>
        <div className="chips">
          <span className="chip">Local-first</span>
          <span className="chip ok">{props.sessionId ? "In session" : "Idle"}</span>
          <span className="chip">Private</span>
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <b>Current Initiative</b>
          <span className="chip">UI</span>
        </div>
        <div className="init-card">
          <span className="init-ico">
            <Hexagon size={16} />
          </span>
          <div>
            <b>Shell</b>
            <p>5ilence theo ui-app.md. Backend tasks chưa nối.</p>
            <div className="progress">
              <i style={{ width: "35%" }} />
            </div>
            <small>35% layout · demo</small>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <b>Tasks</b>
          <span className="hint">demo local</span>
        </div>
        {tasks.map((t) => (
          <label key={t.id} className="task">
            <input
              type="checkbox"
              checked={t.done}
              onChange={() =>
                setTasks((xs) => xs.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))
              }
            />
            <span>{t.title}</span>
            <em>{t.who}</em>
          </label>
        ))}
      </section>

      <section className="card">
        <div className="card-h">
          <b>AI Agents</b>
          <span className="chip">{props.sessionId ? "1" : "0"} active · demo</span>
          <button type="button" className="ghost" title="Chưa kết nối backend — UI only">
            Manage
          </button>
        </div>
        {[
          ["Developer Agent", props.sessionId ? "In session" : "Idle"],
          ["Reviewer Agent", "Idle"],
          ["Test Agent", "Idle"],
        ].map(([name, st]) => (
          <div key={name} className="agent-row">
            <span className={`pulse ${st === "Idle" ? "off" : ""}`} />
            <div>
              <b>{name}</b>
              <small>{st}</small>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-h">
          <b>Context</b>
        </div>
        <dl className="kv">
          <dt>Workspace</dt>
          <dd title={props.workspace}>{props.wsName || "—"}</dd>
          <dt>Model</dt>
          <dd>{props.model}{props.models.length ? ` · ${props.models.length}` : ""}</dd>
          <dt>Network</dt>
          <dd>Allowlist (local)</dd>
          <dt>Cost</dt>
          <dd>${props.costUsd.toFixed(4)}</dd>
        </dl>
      </section>

      <section className="card">
        <div className="card-h">
          <b>MCP</b>
        </div>
        <label className="field">
          Tên
          <input value={props.mcpName} onChange={(e) => props.onMcpName(e.target.value)} />
        </label>
        <label className="field">
          Command
          <input value={props.mcpCmd} onChange={(e) => props.onMcpCmd(e.target.value)} />
        </label>
        <label className="field">
          Args
          <input value={props.mcpArgs} onChange={(e) => props.onMcpArgs(e.target.value)} />
        </label>
        <button type="button" className="ghost" onClick={props.onConnectMcp}>
          Kết nối MCP
        </button>
      </section>
    </aside>
  );
}
