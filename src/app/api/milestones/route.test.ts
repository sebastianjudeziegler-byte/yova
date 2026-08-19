import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE_ID = "22222222-2222-4222-8222-222222222222";
const LINKED_ITEM_ID = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));

import { PATCH, POST } from "@/app/api/milestones/route";

describe("deadline milestone write responses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const builder = {
      insert: mocks.insert,
      update: mocks.update,
      eq: mocks.eq,
      select: mocks.select,
      single: mocks.single,
    };
    mocks.insert.mockReturnValue(builder);
    mocks.update.mockReturnValue(builder);
    mocks.eq.mockReturnValue(builder);
    mocks.select.mockReturnValue(builder);
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.from.mockReturnValue(builder);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
    });
    mocks.single.mockResolvedValue({ data: postgrestRow(), error: null });
  });

  it("returns the committed milestone when POST receives PostgREST offset timestamps", async () => {
    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      milestone: {
        id: MILESTONE_ID,
        title: "Cell biology exam",
        status: "open",
        dueAt: "2026-09-03T23:59:00.000Z",
        createdAt: "2026-08-19T18:02:44.123Z",
      },
    });
    expect(mocks.insert).toHaveBeenCalledWith({
      user_id: USER_ID,
      title: "Cell biology exam",
      description: "Review respiration and photosynthesis.",
      due_at: "2026-09-03T23:59:00.000Z",
      linked_learning_item_id: LINKED_ITEM_ID,
    });
  });

  it("returns a successful PATCH after title, date, and completed status are written", async () => {
    mocks.single.mockResolvedValueOnce({
      data: postgrestRow({
        title: "Updated biology exam",
        due_at: "2026-09-05T23:59:00+00:00",
        status: "completed",
      }),
      error: null,
    });

    const response = await PATCH(updateRequest({
      title: "Updated biology exam",
      dueAt: "2026-09-05T23:59:00.000Z",
      status: "completed",
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.milestone).toMatchObject({
      id: MILESTONE_ID,
      title: "Updated biology exam",
      status: "completed",
      dueAt: "2026-09-05T23:59:00.000Z",
      createdAt: "2026-08-19T18:02:44.123Z",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      title: "Updated biology exam",
      due_at: "2026-09-05T23:59:00.000Z",
      status: "completed",
    });
  });

  it("reports that POST committed when its returned row cannot be represented", async () => {
    mocks.single.mockResolvedValueOnce({
      data: postgrestRow({ created_at: "not-a-timestamp" }),
      error: null,
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toEqual({
      error: "The deadline was saved, but YOVA could not display its confirmed details. Reload the Agenda instead of adding it again.",
      code: "milestone_write_committed_response_invalid",
      committed: true,
      milestoneId: MILESTONE_ID,
    });
    expect(body.error).not.toContain("could not save");
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      "YOVA milestone write committed but its response was invalid",
      expect.objectContaining({ operation: "created", milestoneId: MILESTONE_ID }),
    );
    errorLog.mockRestore();
  });

  it("reports that PATCH committed when its returned row cannot be represented", async () => {
    mocks.single.mockResolvedValueOnce({
      data: postgrestRow({ due_at: "not-a-timestamp" }),
      error: null,
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await PATCH(updateRequest({ status: "completed" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).toEqual({
      error: "The deadline was updated, but YOVA could not display its confirmed details. Reload the Agenda instead of repeating the change.",
      code: "milestone_write_committed_response_invalid",
      committed: true,
      milestoneId: MILESTONE_ID,
    });
    expect(body.error).not.toContain("could not update");
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith(
      "YOVA milestone write committed but its response was invalid",
      expect.objectContaining({ operation: "updated", milestoneId: MILESTONE_ID }),
    );
    errorLog.mockRestore();
  });
});

function postgrestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MILESTONE_ID,
    title: "Cell biology exam",
    description: "Review respiration and photosynthesis.",
    due_at: "2026-09-03T23:59:00+00:00",
    status: "open",
    linked_learning_item_id: LINKED_ITEM_ID,
    created_at: "2026-08-19T18:02:44.123456+00:00",
    ...overrides,
  };
}

function createRequest() {
  return new Request("https://yova.example/api/milestones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Cell biology exam",
      description: "Review respiration and photosynthesis.",
      dueAt: "2026-09-03T23:59:00.000Z",
      linkedLearningItemId: LINKED_ITEM_ID,
    }),
  });
}

function updateRequest(
  changes: Record<string, unknown>,
) {
  return new Request("https://yova.example/api/milestones", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: MILESTONE_ID, ...changes }),
  });
}
