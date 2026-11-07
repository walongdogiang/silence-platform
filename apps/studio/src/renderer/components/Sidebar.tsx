import { ChevronRight, File, FolderClosed, FolderOpen, Search } from "lucide-react";
import type { CSSProperties } from "react";
import logo from "../assets/logo.png";
import mountains from "../assets/wallpapers/mountains.png";

export function Sidebar(props: {
  search: string;
  onSearch: (v: string) => void;
  workspace: string;
  wsName: string;
  tree: string[];
  file: string | null;
  onOpenFile: (path: string) => void;
  onOpenWorkspace: () => void;
  wallpaper: string;
}) {
  const wallpaperUrl = props.wallpaper === "mountains" ? mountains : "";
  const filtered = props.tree.filter((p) =>
    props.search.trim() ? p.toLowerCase().includes(props.search.toLowerCase()) : true,
  );

  return (
    <aside
      className="sidebar"
      style={
        wallpaperUrl
          ? ({ ["--wp" as string]: `url(${wallpaperUrl})` } as CSSProperties)
          : undefined
      }
      data-wp={props.wallpaper}
    >
      <div className="sb-brand">
        <div className="mark" aria-hidden>
          <img src={logo} alt="" width={22} height={22} draggable={false} />
        </div>
        <div className="brand-copy">
          <div className="pane-label">Explorer</div>
          <div className="brand-title">5ilence Studio</div>
        </div>
      </div>

      <label className="sb-search">
        <Search size={14} />
        <input
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder="Search…"
        />
        <kbd>Ctrl+K</kbd>
      </label>

      <div className="sb-ws-head">
        <div className="pane-label">Workspace</div>
        <button type="button" className="ws-select" onClick={props.onOpenWorkspace} title={props.workspace}>
          <FolderOpen size={14} />
          <span>{props.wsName || "Mở workspace"}</span>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="sb-ws">
        {filtered.slice(0, 80).map((p) => {
          const depth = Math.min(p.split("/").length - 1, 6);
          const name = p.split("/").pop() ?? p;
          const isDir = !name.includes(".");
          return (
            <button
              key={p}
              type="button"
              className={`tree-item ${props.file === p ? "active" : ""}`}
              style={{ paddingLeft: 8 + depth * 10 }}
              title={p}
              onClick={() => props.onOpenFile(p)}
            >
              {isDir ? <FolderClosed size={14} /> : <File size={14} />}
              <span>{name}</span>
            </button>
          );
        })}
      </div>

      <div className="sb-foot">
        <div className="user-row">
          <span className="avatar">5</span>
          <div>
            <b>Local</b>
            <small>Developer</small>
          </div>
        </div>
      </div>
    </aside>
  );
}
