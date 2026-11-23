import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_LANG, LANGS, LangContext, type Lang } from "../i18n";
import type { ChatLine } from "../models";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { ChatPane } from "./ChatPane";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeleteChatDialog } from "./DeleteChatDialog";
import { UndoToast } from "./UndoToast";
import { TitleBar } from "./TitleBar";

/** Vietnamese letters with diacritics: none may show in the English UI (user/agent text aside). */
const VI = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

const inLang = (lang: Lang, node: ReactNode) =>
  renderToStaticMarkup(<LangContext.Provider value={lang}>{node}</LangContext.Provider>);

const noop = () => {};

const lines: ChatLine[] = [
  { kind: "user", text: "explain the project" },
  { kind: "narrate", verb: "Read", detail: "App.tsx (1–40)", file: "src/App.tsx", ranges: [[1, 40]] },
  { kind: "narrate", verb: "Searched", detail: "`foo` in a.ts" },
  { kind: "thought", brief: "Thought", body: "thinking", ms: 3000 },
  { kind: "worked", ms: 21_000, at: 0 },
  { kind: "checkpoint", id: "cp", at: 0, label: "Checkpoint", files: [{ path: "a.ts", before: "", after: "x" }] },
  { kind: "tool", name: "read", output: "ok" },
  { kind: "token", text: "Done." },
  { kind: "error", message: "boom", info: { code: "NETWORK", retryable: true, detail: "" } },
];

const pane = (
  <ChatPane
    lines={lines}
    plan={"1. Add the parser module\n2. Wire it into the CLI"}
    perm={{
      session_id: "s",
      request_id: "r",
      name: "shell",
      input: { command: "npm install zod" },
      reason: "",
      risk: { tier: "ask", reasons: [], pattern: "npm install *" },
    }}
    diff={{ path: "src/a.ts", before: "a\n", after: "b\n" }}
    sessionId="s"
    hasSession
    wsName="demo"
    onApprovePlan={noop}
    onRevisePlan={noop}
    onAllow={noop}
    onDeny={noop}
    onApplyDiff={noop}
    onRejectDiff={noop}
    onShowDiff={noop}
    onRestoreCheckpoint={noop}
    onForkChat={noop}
    onRetry={noop}
    permError
  />
);

const composer = (
  <Composer
    prompt=""
    onPrompt={noop}
    onSend={noop}
    onChip={noop}
    mode="agent"
    model="auto"
    models={[]}
    onModel={noop}
    files={["src/a.ts"]}
    busy={false}
    disabled={false}
  />
);

const history = (
  <ChatHistoryPanel
    workspace="w"
    threads={[{ id: "1", sessionId: "s", workspace: "w", title: "Đoạn chat mới", preview: "", updatedAt: Date.now(), lines: [{ kind: "user", text: "hi" }] }]}
    activeId="1"
    onNewChat={noop}
    onSelect={noop}
    onDelete={noop}
    onRename={noop}
    onCustomize={noop}
    onToggle={noop}
  />
);

const titleBar = (
  <TitleBar
    wsName="demo"
    chatHidden={false}
    panelOpen={false}
    historyHidden={false}
    canBack={false}
    canForward={false}
    onBack={noop}
    onForward={noop}
    onTogglePanel={noop}
    onOpenTerminal={noop}
    onToggleChatWorkspace={noop}
    onToggleHistory={noop}
    onSettings={noop}
    onOpenWorkspace={noop}
    onQuit={noop}
  />
);

const confirmDialog = (
  <ConfirmDialog title="Rewind?" body="Body" confirmLabel="Rewind" danger onResult={noop} />
);
const deleteDialog = <DeleteChatDialog title="My chat" turns={3} onCancel={noop} onDelete={noop} onArchive={noop} />;
const undoToast = <UndoToast title="My chat" onUndo={noop} onDismiss={noop} />;

describe("UI language sweep", () => {
  it.each([
    ["ChatPane", pane],
    ["Composer", composer],
    ["ChatHistoryPanel", history],
    ["TitleBar", titleBar],
    ["ConfirmDialog", confirmDialog],
    ["DeleteChatDialog", deleteDialog],
    ["UndoToast", undoToast],
  ])("%s in English has no Vietnamese text", (_, node) => {
    const out = inLang("en", node);
    const at = out.search(VI);
    // On failure, shows the markup around the first Vietnamese letter.
    expect(at < 0 ? "" : out.slice(Math.max(0, at - 60), at + 20)).toBe("");
  });

  it("the same views switch to Vietnamese", () => {
    expect(inLang("en", pane)).toContain("Explored 1 file");
    expect(inLang("en", history)).toContain("New chat");
    expect(inLang("vi", pane)).toContain("Đã khảo sát");
    expect(inLang("vi", pane)).toContain("Cho phép");
    expect(inLang("vi", composer)).toContain("Lập kế hoạch, xây dựng");
    expect(inLang("en", composer)).toContain("Plan, Build, / for skills, @ for context");
  });

  it("delete dialog and undo toast switch language and show the countdown", () => {
    expect(inLang("en", deleteDialog)).toContain("Delete chat?");
    expect(inLang("en", deleteDialog)).toContain("and its 3 messages");
    expect(inLang("vi", deleteDialog)).toContain("Xoá đoạn chat?");
    expect(inLang("vi", deleteDialog)).toContain("cùng 3 tin nhắn");
    expect(inLang("en", undoToast)).toContain("Undo");
    expect(inLang("en", undoToast)).toContain("8s");
    expect(inLang("vi", undoToast)).toContain("Hoàn tác");
  });

  it("English is the default language", () => {
    expect(DEFAULT_LANG).toBe("en");
    expect(LANGS[0].id).toBe("en");
  });
});
