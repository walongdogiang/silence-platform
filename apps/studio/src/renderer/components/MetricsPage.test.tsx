import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext, translator } from "../i18n";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { ExternalTranscript, type ExternalItem } from "./ExternalSessionView";
import { comparisonRows, compact, MetricsView, pct, perTurn, type MetricsSummary, type Totals } from "./MetricsPage";

const en = translator("en");
const tot = (o: Partial<Totals>): Totals => ({ sessions: 0, turns: 0, falseDone: 0, verifiedTurns: 0, fixRounds: 0, repeats: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usd: 0, ...o });
const summary: MetricsSummary = {
  days: 30,
  core: tot({ sessions: 4, turns: 40, falseDone: 3, verifiedTurns: 12, fixRounds: 4, repeats: 2, inputTokens: 1000, outputTokens: 52_000, cacheReadTokens: 2_400_000, usd: 1.234 }),
  external: tot({ sessions: 10, turns: 120, repeats: 9, outputTokens: 900_000 }),
  byDay: [{ day: "2026-11-22", core: tot({ turns: 5, falseDone: 1, verifiedTurns: 2 }), external: tot({ turns: 7 }) }],
  byProject: [{ project: "5ilence", core: tot({ turns: 40 }), external: tot({ turns: 100 }) }],
  quota: { status: "warning", utilization: 0.82, window: "five_hour", at: "2026-11-22T10:00:00Z" },
};

describe("metric helpers", () => {
  it("format counts, shares and per-turn averages", () => {
    expect(compact(950)).toBe("950");
    expect(compact(52_000)).toBe("52.0k");
    expect(compact(2_400_000)).toBe("2.4M");
    expect(pct(3, 12)).toBe("25%");
    expect(pct(1, 0)).toBe("—");
    expect(perTurn(4, 12)).toBe("0.3");
  });

  it("compare only what both sides record; false done is 5ilence-only", () => {
    const rows = comparisonRows(summary, en);
    expect(rows.find((r) => r.label === "False done")).toMatchObject({ core: "25%", external: "—" });
    expect(rows.find((r) => r.label === "Repeated messages")).toMatchObject({ core: "5%", external: "8%" });
    expect(rows.find((r) => r.label === "Turns per session")).toMatchObject({ core: "10.0", external: "12.0" });
  });
});

describe("MetricsView", () => {
  it("shows the tiles, the comparison and the breakdowns", () => {
    const out = renderToStaticMarkup(
      <LangContext.Provider value="en">
        <MetricsView summary={summary} />
      </LangContext.Provider>,
    );
    expect(out).toContain("3 of 12 checked turns");
    expect(out).toContain("$1.23");
    expect(out).toContain("Last quota report: warning, 82% used (five_hour)");
    expect(out).toContain("5ilence vs bare Claude");
    expect(out).toContain("<th scope=\"row\">2026-11-22</th>");
    expect(out).toContain("<th scope=\"row\">5ilence</th>");
  });
});

describe("outside sessions", () => {
  const item: ExternalItem = { backend_session_id: "e1", title: "Fix the build", workspace: "D:\\w\\shop", updated_at: "2026-11-21T09:00:00Z" };

  it("render the transcript read-only", () => {
    const out = renderToStaticMarkup(
      <LangContext.Provider value="en">
        <ExternalTranscript lines={[{ role: "user", text: "fix it" }, { role: "assistant", text: "**Done.**" }]} />
      </LangContext.Provider>,
    );
    expect(out).toContain('<div class="external-user">fix it</div>');
    expect(out).toContain("<strong>Done.</strong>");
  });

  it("are listed in the history under Claude desktop / terminal", () => {
    const out = renderToStaticMarkup(
      <LangContext.Provider value="en">
        <ChatHistoryPanel workspace="D:/w/shop" threads={[]} activeId="" onNewChat={() => {}} onSelect={() => {}} onDelete={() => {}} onRename={() => {}} onCustomize={() => {}} onToggle={() => {}} external={{ items: [item], onOpen: () => {} }} />
      </LangContext.Provider>,
    );
    expect(out).toContain("Claude desktop / terminal (1)");
  });
});
