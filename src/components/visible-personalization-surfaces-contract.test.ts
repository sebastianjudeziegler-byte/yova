import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/yova-prototype.tsx"),
  "utf8",
);

describe("visible personalization surfaces", () => {
  it("keeps Home's collapsed route to mode, method, total time, reason, and Start", () => {
    const start = source.indexOf("function HomeScreen(");
    const end = source.indexOf("function SubjectIcon", start);
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

  it("shows Agenda's collapsed route with total elapsed time and its short reason", () => {
    const start = source.indexOf("function AgendaScreen(");
    const end = source.indexOf("function AskScreen", start);
    const agenda = source.slice(start, end);

    expect(agenda).toContain("agendaRoute?.timing.elapsedMinutes ?? session.estimatedMinutes");
    expect(agenda).toContain("agendaRoute?.explanation.shortReason ?? session.methodReason");
    expect(agenda).toContain('=== "learn" ? "Learn" : "Practice"');
    expect(agenda).toContain("{selectSessionMethodName(plan, session)} · {agendaTotalMinutes} minutes");
    expect(agenda).toContain("<small>{agendaReason}</small>");
    expect(agenda).toContain('resumePoint ? "Continue" : "Start"');
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
