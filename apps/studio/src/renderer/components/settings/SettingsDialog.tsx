import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Bell, Bot, Database, Info, Keyboard, MessageSquare, Palette, Plug, Search, Settings2, ShieldCheck, X } from "lucide-react";
import { useT } from "../../i18n";
import type { Appearance } from "../../theme/appearance";
import type { Prefs } from "../../prefs";
import type { UiPermMode } from "../../permissionUi";
import type { SandboxStatus } from "../../types";
import { modelSources } from "../../effort";
import {
  SECTIONS,
  saveSettingsSection,
  searchSettings,
  type SettingEntry,
  type SettingsSection,
} from "../../settingsIndex";
import type { NetworkTab } from "../../networkTabs";
import { NetworkPanel, type NetworkGuard } from "../NetworkPanel";
import { PermissionsSection } from "../PermissionsSection";
import { UnsavedDialog } from "../UnsavedDialog";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { ChatSection } from "./ChatSection";
import { DataSection } from "./DataSection";
import { NotificationsSection } from "./NotificationsSection";
import { GeneralSection } from "./GeneralSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { ToolsSection } from "./ToolsSection";

const ICONS: Record<SettingsSection, typeof Settings2> = {
  general: Settings2,
  appearance: Palette,
  chat: MessageSquare,
  notifications: Bell,
  permissions: ShieldCheck,
  models: Bot,
  tools: Plug,
  data: Database,
  shortcuts: Keyboard,
  about: Info,
};

/** Sections shown under the divider in the left column. */
const LOWER: SettingsSection[] = ["shortcuts", "about"];

type ModelsProps = Omit<ComponentProps<typeof NetworkPanel>, "guardRef" | "embedded" | "focusTab">;

/**
 * Settings dialog (Claude-style): search + sections on the left, rows on the right. Appearance,
 * language and permissions apply at once; Models keeps its own Save / Cancel / Reset bar and
 * asks before its draft is dropped (closing the dialog or leaving the section).
 */
export function SettingsDialog(props: {
  /** Section to show; `n` changes on every open so the same section can be re-requested. */
  open: { section: SettingsSection; n: number };
  onClose: () => void;
  appearance: Appearance;
  onAppearance: (next: Appearance) => void;
  prefs: Prefs;
  onPrefs: (next: Prefs) => void;
  chatCount: number;
  onClearHistory: () => Promise<number>;
  /** Open the Evals page; omitted when the Engine has no evals (not a dev checkout). */
  onOpenEvals?: () => void;
  workspace: string;
  permMode: UiPermMode;
  onPermMode: (m: UiPermMode) => void;
  sandbox: SandboxStatus | null;
  onRefreshSandbox: () => Promise<void>;
  onSetupSandbox: () => Promise<void>;
  models: ModelsProps;
}) {
  const t = useT();
  const [section, setSectionState] = useState<SettingsSection>(props.open.section);
  const [query, setQuery] = useState("");
  const [flashId, setFlashId] = useState<{ id: string; n: number } | null>(null);
  const [focusTab, setFocusTab] = useState<{ tab: NetworkTab; n: number } | null>(null);
  const [pending, setPending] = useState<null | (() => void)>(null);
  const guard = useRef<NetworkGuard | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  function setSection(s: SettingsSection) {
    setSectionState(s);
    saveSettingsSection(s);
  }

  useEffect(() => {
    setSectionState(props.open.section);
    saveSettingsSection(props.open.section);
  }, [props.open.n, props.open.section]);

  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  /** Run `go` now, or after the user decides what to do with an unsaved Models draft. */
  function leaveModels(go: () => void) {
    if (section === "models" && guard.current?.dirty) setPending(() => go);
    else go();
  }

  function close() {
    leaveModels(props.onClose);
  }

  function choose(choice: "save" | "discard" | "stay") {
    const go = pending;
    setPending(null);
    if (choice === "stay" || !go) return;
    if (choice === "save") guard.current?.save();
    else guard.current?.discard();
    go();
  }

  function openEntry(e: SettingEntry) {
    leaveModels(() => {
      setQuery("");
      setSection(e.section);
      if (e.tab) setFocusTab({ tab: e.tab, n: Date.now() });
      setFlashId({ id: e.id, n: Date.now() });
    });
  }

  // Scroll to and flash the row a search result points at.
  useEffect(() => {
    if (!flashId) return;
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-setting="${CSS.escape(flashId.id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.remove("set-flash");
    void el.offsetWidth;
    el.classList.add("set-flash");
  }, [flashId, section]);

  // Esc closes (unless the unsaved dialog is up: it handles Esc itself); Tab stays inside.
  function onKeyDown(e: React.KeyboardEvent) {
    if (pending) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else close();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((x) => x.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const results = searchSettings(query, t);
  const sources = modelSources(props.models.catalog);
  const sectionLabel = (s: SettingsSection) => t(SECTIONS.find((x) => x.id === s)!.label);

  function navItem(s: SettingsSection) {
    const Icon = ICONS[s];
    const on = !query && section === s;
    return (
      <button
        key={s}
        type="button"
        className={`set-nav-item${on ? " on" : ""}`}
        aria-current={on ? "page" : undefined}
        onClick={() =>
          leaveModels(() => {
            setQuery("");
            setSection(s);
          })
        }
      >
        <Icon size={16} aria-hidden="true" />
        {sectionLabel(s)}
      </button>
    );
  }

  return (
    <div className="set-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={dialogRef}
        className="set-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-title"
        onKeyDown={onKeyDown}
      >
        <header className="set-head">
          <h2 id="set-title">{t("settings.title")}</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>
        <div className="set-body">
          <nav className="set-nav" aria-label={t("settings.title")}>
            <label className="set-search">
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("settings.search")}
                aria-label={t("settings.search")}
              />
            </label>
            {SECTIONS.filter((s) => !LOWER.includes(s.id)).map((s) => navItem(s.id))}
            <hr />
            {LOWER.map(navItem)}
          </nav>

          <div className="set-content" ref={contentRef}>
            {query ? (
              <>
                <h2 className="set-content-title">{t("settings.results")}</h2>
                {results.length === 0 ? (
                  <p className="set-empty">{t("settings.noResults")}</p>
                ) : (
                  <ul className="set-results">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => openEntry(r)}>
                          <span className="set-result-section">{sectionLabel(r.section)}</span>
                          <b>{t(r.label)}</b>
                          {r.desc ? <small>{t(r.desc)}</small> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <h2 className="set-content-title">{sectionLabel(section)}</h2>
                {section === "general" ? (
                  <GeneralSection
                    appearance={props.appearance}
                    onAppearance={props.onAppearance}
                    sources={sources}
                    prefs={props.prefs}
                    onPrefs={props.onPrefs}
                    onOpenSources={() => {
                      setSection("models");
                      setFocusTab({ tab: "sources", n: Date.now() });
                    }}
                  />
                ) : null}
                {section === "appearance" ? (
                  <AppearanceSection
                    value={props.appearance}
                    onChange={props.onAppearance}
                    prefs={props.prefs}
                    onPrefs={props.onPrefs}
                  />
                ) : null}
                {section === "chat" ? <ChatSection prefs={props.prefs} onPrefs={props.onPrefs} /> : null}
                {section === "notifications" ? (
                  <NotificationsSection prefs={props.prefs} onPrefs={props.onPrefs} />
                ) : null}
                {section === "permissions" ? (
                  <PermissionsSection
                    workspace={props.workspace}
                    mode={props.permMode}
                    onMode={props.onPermMode}
                    sandbox={props.sandbox}
                    onRefreshSandbox={props.onRefreshSandbox}
                    onSetupSandbox={props.onSetupSandbox}
                  />
                ) : null}
                {section === "models" ? (
                  <NetworkPanel {...props.models} embedded guardRef={guard} focusTab={focusTab} />
                ) : null}
                {section === "tools" ? <ToolsSection workspace={props.workspace} /> : null}
                {section === "data" ? (
                  <DataSection
                    prefs={props.prefs}
                    onPrefs={props.onPrefs}
                    chatCount={props.chatCount}
                    onClearHistory={props.onClearHistory}
                  />
                ) : null}
                {section === "shortcuts" ? <ShortcutsSection /> : null}
                {section === "about" ? <AboutSection onOpenEvals={props.onOpenEvals} /> : null}
              </>
            )}
          </div>
        </div>
      </div>
      {pending ? <UnsavedDialog onChoose={choose} /> : null}
    </div>
  );
}
