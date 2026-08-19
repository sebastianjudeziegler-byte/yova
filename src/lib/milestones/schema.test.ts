import { describe, expect, it } from "vitest";
import {
  DeadlineMilestoneSchema,
  deadlineMilestoneFromRow,
} from "@/lib/milestones/schema";

function milestoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "8ba40566-b6b9-47b5-a702-06db94ae6e88",
    title: "Cell biology test",
    description: "Review before the test",
    due_at: "2026-09-03T23:59:00+00:00",
    status: "open",
    linked_learning_item_id: null,
    created_at: "2026-08-19T06:42:11+00:00",
    ...overrides,
  };
}

describe("deadline milestone database boundary", () => {
  it("normalizes PostgREST UTC-offset timestamps before strict response validation", () => {
    const milestone = deadlineMilestoneFromRow(milestoneRow());

    expect(milestone.dueAt).toBe("2026-09-03T23:59:00.000Z");
    expect(milestone.createdAt).toBe("2026-08-19T06:42:11.000Z");
    expect(DeadlineMilestoneSchema.safeParse(milestone).success).toBe(true);
  });

  it("normalizes PostgREST fractional seconds and non-zero offsets", () => {
    const milestone = deadlineMilestoneFromRow(
      milestoneRow({
        due_at: "2026-09-03T18:59:00.123456-05:00",
        created_at: "2026-08-19T08:42:11.987654+02:00",
      }),
    );

    expect(milestone.dueAt).toBe("2026-09-03T23:59:00.123Z");
    expect(milestone.createdAt).toBe("2026-08-19T06:42:11.987Z");
    expect(DeadlineMilestoneSchema.safeParse(milestone).success).toBe(true);
  });

  it("does not broaden the public response schema to accept offset timestamps", () => {
    expect(
      DeadlineMilestoneSchema.safeParse({
        ...deadlineMilestoneFromRow(milestoneRow()),
        dueAt: "2026-09-03T23:59:00+00:00",
      }).success,
    ).toBe(false);
  });
});
