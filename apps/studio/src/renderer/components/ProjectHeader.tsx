import { Star } from "lucide-react";
import mountains from "../assets/wallpapers/mountains.webp";
import type { CenterTab } from "../models";

const TABS: { id: CenterTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "plan", label: "Plan" },
  { id: "tasks", label: "Tasks" },
  { id: "files", label: "Files" },
  { id: "tests", label: "Tests" },
  { id: "decisions", label: "Decisions" },
  { id: "logs", label: "Logs" },
];

export function ProjectHeader(props: {
  wsName: string;
  tab: CenterTab;
  onTab: (t: CenterTab) => void;
}) {
  return (
    <div className="project-head">
      <div className="ph-top">
        <img className="ph-thumb" src={mountains} alt="" />
        <div className="ph-meta">
          <div className="ph-title">
            <h1>{props.wsName || "5ilence"}</h1>
            <Star size={14} />
          </div>
          <p>Local-first · Multi-agent · Decision-driven development</p>
        </div>
        <div className="ph-actions">
          <span className="chip">main</span>
          <span className="chip ok">Local</span>
          <span className="chip ok">Synced</span>
        </div>
      </div>
      <div className="ph-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={props.tab === t.id ? "active" : ""}
            onClick={() => props.onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
