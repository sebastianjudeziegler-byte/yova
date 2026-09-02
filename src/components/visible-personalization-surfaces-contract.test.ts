import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/yova-prototype.tsx"),
  "utf8",
);
const calendarSource = readFileSync(
  resolve(process.cwd(), "src/components/calendar/calendar-screen.tsx"),
  "utf8",
);

describe("visible personalization surfaces", () => {
  it("keeps Home's collapsed route to mode, method, total time, reason, and Start", () => {
    const start = source.indexOf("function HomeScreen(");
    const end = source.indexOf("function formatHomeDate", start);
    const home = source.slice(start, end);
    const chipsStart = home.indexOf('<div className="hg-chip-row">');
    const chipsEnd = home.indexOf("</div>", chipsStart);
    const chips = home.slice(chipsStart, chipsEnd);

    expect(home).toContain("homeRoute?.timing.elapsedMinutes");
    expect(home).toContain("homeRoute?.explanation.shortReason");
    expect(home).toContain('selectSessionLearningMode(displayedPlan, readySession) === "learn" ? "Learn" : "Practice"');
    expect(home).toContain("selectSessionMethodName(displayedPlan, readySession)");
    expect(chips).toContain("{homeSessionType}");
    expect(chips).toContain("{homeMethod}");
    expect(chips).toContain("{homeTotalMinutes} minutes");
    expect(chips).not.toContain("{displayedPlan.title}");
    expect(home).toContain("<strong>WHY THIS · </strong>{methodFit}");
    expect(home).toContain('resumePoint ? "Continue session" : "Start session"');
  });

  it("shows Calendar's session mode, bounded time, exact method, and evidence-backed reasons", () => {
    const start = calendarSource.indexOf("function SelectedBlockDetail(");
    const end = calendarSource.indexOf("function YourDayCard(", start);
    const detail = calendarSource.slice(start, end);
    const labelStart = calendarSource.indexOf("function blockTypeLabel(");
    const labelEnd = calendarSource.indexOf("function outcomeStatusLabel(", labelStart);
    const label = calendarSource.slice(labelStart, labelEnd);

    expect(label).toContain('block.learningMode === "learn" ? "Learn" : "Practice"');
    expect(detail).toContain("const minutes = blockMinutes(block)");
    expect(detail).toContain("{formatDateTime(block.startsAt)} · {minutes} min");
    expect(detail).toContain("<dt>Why here</dt><dd>{reason}</dd>");
    expect(detail).toContain("<dt>Method</dt><dd>{block.methodName}</dd>");
    expect(detail).toContain("<dt>Why this method</dt><dd>{block.methodReason}</dd>");
    expect(detail).toContain('advertiseContinue ? "Continue" : "Start"');
  });

  it("renders the evidence-backed receipt after guided and ungraded sessions", () => {
    const start = source.indexOf("function SessionComplete(");
    const end = source.indexOf("function formatElapsedDuration", start);
    const completion = source.slice(start, end);

    expect(completion.match(/<PostSessionPersonalizationReceipt/g)).toHaveLength(2);
    expect(completion).toContain('completionMode === "unguided_practice" ? [] : conceptEvidence');
    expect(completion).toContain("executedRouteRevisionId");
    expect(completion).toContain("decision={decision}");
    expect(completion).toContain("decision={null}");
  });
});
