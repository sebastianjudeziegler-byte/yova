import { describe, expect, it } from "vitest";
import { isMilestoneOverdue, nextActionableMilestone } from "@/lib/milestones/agenda";

const NOW = new Date("2026-08-21T12:00:00.000Z");

describe("Agenda deadline reachability", () => {
  it("prioritizes an overdue open deadline ahead of future and completed rows", () => {
    const milestones = [
      { id: "future", dueAt: "2026-08-24T23:59:59.000Z", status: "open" as const },
      { id: "completed", dueAt: "2026-08-18T23:59:59.000Z", status: "completed" as const },
      { id: "overdue", dueAt: "2026-08-20T12:00:00.000Z", status: "open" as const },
    ];

    expect(nextActionableMilestone(milestones)?.id).toBe("overdue");
    expect(isMilestoneOverdue(milestones[2]!, NOW)).toBe(true);
    expect(isMilestoneOverdue(milestones[0]!, NOW)).toBe(false);
  });

  it("returns no shortcut only when every deadline is complete", () => {
    expect(nextActionableMilestone([
      { dueAt: "2026-08-20T23:59:59.000Z", status: "completed" as const },
    ])).toBeNull();
  });
});
