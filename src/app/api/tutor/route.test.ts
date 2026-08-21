import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  generateTutorAnswer: vi.fn(),
  claimAIRequest: vi.fn(),
  releaseAIRequestClaim: vi.fn(),
  releaseAIRequestReservation: vi.fn(),
  settleAIRequestClaim: vi.fn(),
}));

vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createClient,
}));
vi.mock("@/lib/openai/config", () => ({ isOpenAITutorConfigured: () => true }));
vi.mock("@/lib/openai/tutor-generator", () => ({ generateTutorAnswer: mocks.generateTutorAnswer }));
vi.mock("@/lib/server/rate-limit", () => ({
  checkTutorRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
  requestRateLimitKey: () => "route-test",
}));
vi.mock("@/lib/server/ai-usage", () => ({
  reserveAIRequest: mocks.claimAIRequest,
  releaseAIRequestClaim: mocks.releaseAIRequestClaim,
  releaseAIRequestReservation: mocks.releaseAIRequestReservation,
  settleAIRequestClaim: mocks.settleAIRequestClaim,
}));

import { GET, POST } from "@/app/api/tutor/route";

const GENERAL_THREAD_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_THREAD_ID = "22222222-2222-4222-8222-222222222222";
const COMPLETED_THREAD_ID = "33333333-3333-4333-8333-333333333333";
const ARCHIVED_THREAD_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_THREAD_ID = "55555555-5555-4555-8555-555555555555";
const ORPHAN_THREAD_ID = "66666666-6666-4666-8666-666666666666";
const ACTIVE_ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPLETED_ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ARCHIVED_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DRAFT_ITEM_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ORPHAN_ITEM_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACTIVE_PLAN_ID = "77777777-7777-4777-8777-777777777777";
const COMPLETED_PLAN_ID = "88888888-8888-4888-8888-888888888888";
const ARCHIVED_PLAN_ID = "99999999-9999-4999-8999-999999999999";
const DRAFT_PLAN_ID = "10101010-1010-4010-8010-101010101010";

describe("tutor plan visibility", () => {
  let database: ReturnType<typeof tutorDatabase>;

  beforeEach(() => {
    database = tutorDatabase();
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.from.mockReset().mockImplementation(database.from);
    mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
    mocks.generateTutorAnswer.mockReset().mockResolvedValue({
      answer: "A useful answer.",
      model: "gpt-test",
      responseId: "response-1",
    });
    mocks.claimAIRequest.mockReset().mockResolvedValue({
      allowed: true,
      claimId: "12121212-1212-4212-8212-121212121212",
      retryAfterSeconds: 0,
    });
    mocks.releaseAIRequestClaim.mockReset().mockResolvedValue(true);
    mocks.releaseAIRequestReservation.mockReset().mockResolvedValue(false);
    mocks.settleAIRequestClaim.mockReset().mockResolvedValue(true);
    mocks.createClient.mockReset().mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: mocks.from,
      rpc: mocks.rpc,
    });
  });

  it("omits archived, draft, and orphaned plan threads from conversation history", async () => {
    const response = await GET(request("?mode=threads"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      threads: [
        { id: GENERAL_THREAD_ID, learningItemId: null },
        { id: ACTIVE_THREAD_ID, learningItemId: ACTIVE_ITEM_ID, contextTitle: "Active goal" },
        { id: COMPLETED_THREAD_ID, learningItemId: COMPLETED_ITEM_ID, contextTitle: "Completed goal" },
      ],
    });
  });

  it.each([
    ["archived", ARCHIVED_PLAN_ID],
    ["draft", DRAFT_PLAN_ID],
  ])("rejects %s plan context before loading its materials", async (_status, planId) => {
    const response = await GET(request(`?planId=${planId}`));

    expect(response.status).toBe(404);
    expect(mocks.from).not.toHaveBeenCalledWith("learning_items");
    expect(mocks.from).not.toHaveBeenCalledWith("materials");
    expect(mocks.from).not.toHaveBeenCalledWith("plan_sessions");
  });

  it("allows completed plan context and its historical materials", async () => {
    const response = await GET(request(`?planId=${COMPLETED_PLAN_ID}`));

    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("materials");
    await expect(response.json()).resolves.toMatchObject({
      threadId: COMPLETED_THREAD_ID,
      messages: [],
    });
  });

  it("does not expose an archived plan thread by direct thread id", async () => {
    const response = await GET(request(`?threadId=${ARCHIVED_THREAD_ID}`));

    expect(response.status).toBe(404);
    expect(mocks.from).not.toHaveBeenCalledWith("tutor_messages");
  });

  it("validates a generated exchange before writing it to the tutor thread", async () => {
    mocks.generateTutorAnswer.mockResolvedValueOnce({
      answer: "x".repeat(12_001),
      model: "gpt-test",
      responseId: "response-1",
    });

    const response = await POST(new Request("https://yova.example/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Explain this topic", persistenceMode: "thread" }),
    }));

    expect(response.status).toBe(502);
    expect(mocks.rpc).not.toHaveBeenCalledWith("save_tutor_exchange", expect.anything());
    expect(mocks.releaseAIRequestClaim).toHaveBeenCalledWith(
      expect.anything(),
      "12121212-1212-4212-8212-121212121212",
    );
    expect(mocks.settleAIRequestClaim).not.toHaveBeenCalled();
  });

  it("settles a validated learner-usable tutor response", async () => {
    const response = await POST(new Request("https://yova.example/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Explain this topic", persistenceMode: "thread" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.settleAIRequestClaim).toHaveBeenCalledWith(
      expect.anything(),
      "12121212-1212-4212-8212-121212121212",
    );
    expect(mocks.releaseAIRequestClaim).not.toHaveBeenCalled();
  });

  it("returns a valid tutor answer when settlement cannot be confirmed", async () => {
    mocks.settleAIRequestClaim.mockRejectedValueOnce(new Error("settlement receipt lost"));

    const response = await POST(new Request("https://yova.example/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Explain this topic", persistenceMode: "thread" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.releaseAIRequestClaim).not.toHaveBeenCalled();
  });

  it("does not start tutor generation for a live operation-key replay", async () => {
    mocks.claimAIRequest.mockResolvedValueOnce({
      allowed: false,
      claimId: null,
      operationKey: "22222222-2222-4222-8222-222222222222",
      denialReason: "operation_in_progress",
      retryAfterSeconds: 33,
      remainingToday: 7,
    });

    const response = await POST(new Request("https://yova.example/api/tutor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Explain this topic", persistenceMode: "thread" }),
    }));

    expect(response.status).toBe(409);
    expect(response.headers.get("Retry-After")).toBe("33");
    await expect(response.json()).resolves.toMatchObject({
      code: "ai_operation_in_progress",
      retryable: true,
    });
    expect(mocks.generateTutorAnswer).not.toHaveBeenCalled();
    expect(mocks.releaseAIRequestClaim).not.toHaveBeenCalled();
    expect(mocks.settleAIRequestClaim).not.toHaveBeenCalled();
  });
});

function request(query = "") {
  return new Request(`https://yova.example/api/tutor${query}`);
}

function tutorDatabase() {
  const timestamp = "2026-08-18T12:00:00.000Z";
  const tables: Record<string, Array<Record<string, unknown>>> = {
    learner_profiles: [],
    learning_items: [
      learningItem(ACTIVE_ITEM_ID, "Active goal", "active"),
      learningItem(COMPLETED_ITEM_ID, "Completed goal", "completed"),
      learningItem(ARCHIVED_ITEM_ID, "Archived goal", "archived"),
      learningItem(DRAFT_ITEM_ID, "Draft goal", "active"),
    ],
    plans: [
      plan(ACTIVE_PLAN_ID, ACTIVE_ITEM_ID, "active"),
      plan(COMPLETED_PLAN_ID, COMPLETED_ITEM_ID, "completed"),
      plan(ARCHIVED_PLAN_ID, ARCHIVED_ITEM_ID, "archived"),
      plan(DRAFT_PLAN_ID, DRAFT_ITEM_ID, "draft"),
    ],
    plan_sessions: [],
    materials: [{
      id: "material-1",
      learning_item_id: COMPLETED_ITEM_ID,
      filename: "completed-notes.txt",
      extracted_text: "Retained historical study material.",
      processing_status: "ready",
      created_at: timestamp,
    }],
    tutor_messages: [],
    tutor_threads: [
      thread(GENERAL_THREAD_ID, null, timestamp),
      thread(ACTIVE_THREAD_ID, ACTIVE_ITEM_ID, timestamp),
      thread(COMPLETED_THREAD_ID, COMPLETED_ITEM_ID, timestamp),
      thread(ARCHIVED_THREAD_ID, ARCHIVED_ITEM_ID, timestamp),
      thread(DRAFT_THREAD_ID, DRAFT_ITEM_ID, timestamp),
      thread(ORPHAN_THREAD_ID, ORPHAN_ITEM_ID, timestamp),
    ],
  };

  return {
    from: (table: string) => query(tables[table] ?? []),
  };
}

function query(sourceRows: Array<Record<string, unknown>>) {
  let rows = [...sourceRows];
  let limitCount: number | null = null;
  const builder: Record<string, unknown> & PromiseLike<{
    data: Array<Record<string, unknown>>;
    error: null;
  }> = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    }),
    in: vi.fn((column: string, values: unknown[]) => {
      rows = rows.filter((row) => values.includes(row[column]));
      return builder;
    }),
    is: vi.fn((column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn((value: number) => {
      limitCount = value;
      return builder;
    }),
    maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
    then: (resolve, reject) => Promise.resolve({
      data: limitCount === null ? rows : rows.slice(0, limitCount),
      error: null,
    }).then(resolve, reject),
  };
  return builder;
}

function learningItem(id: string, title: string, status: string) {
  return { id, title, topic: title, status };
}

function plan(id: string, learningItemId: string, status: string) {
  return {
    id,
    learning_item_id: learningItemId,
    rationale: `${status} plan`,
    status,
  };
}

function thread(id: string, learningItemId: string | null, timestamp: string) {
  return {
    id,
    learning_item_id: learningItemId,
    title: `Thread ${id.slice(0, 4)}`,
    created_at: timestamp,
    updated_at: timestamp,
  };
}
