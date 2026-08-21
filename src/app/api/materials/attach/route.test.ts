import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialUnderstanding, PlanKnowledgeMap } from "@/lib/knowledge-map/schema";

vi.mock("server-only", () => ({}));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLAN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN_TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const MATERIAL_ID = "33333333-3333-4333-8333-333333333333";
const MATERIAL_TOPIC_ID = "44444444-4444-4444-8444-444444444444";
const CHUNK_ID = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  mapMaterial: vi.fn(),
  rpc: vi.fn(),
  sessionStepData: { topicIds: ["11111111-1111-4111-8111-111111111111"] } as Record<string, unknown>,
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/materials/material-understanding", () => ({
  MATERIAL_MAPPING_ROUTE_BUDGET_MS: 90_000,
  mapAndPersistMaterial: mocks.mapMaterial,
}));

import { POST } from "@/app/api/materials/attach/route";
import { MaterialAttachmentResponseSchema } from "@/lib/materials/attachment-schema";

describe("active-plan material attachment route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessionStepData = { topicIds: [PLAN_TOPIC_ID] };
    const client = materialClient();
    mocks.createClient.mockResolvedValue(client);
    mocks.rpc.mockImplementation(async (_name, input) => ({
      data: {
        planId: PLAN_ID,
        sourceMode: "user_materials",
        materials: [materialResponse()],
        knowledgeMap: (input as { payload: { knowledgeMap: unknown } }).payload.knowledgeMap,
      },
      error: null,
    }));
    mocks.mapMaterial.mockResolvedValue(undefined);
  });

  it("atomically reconciles a durably mapped source before reporting it attached", async () => {
    const response = await POST(attachRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(MaterialAttachmentResponseSchema.safeParse(body).success).toBe(true);
    expect(body.materials).toEqual([expect.objectContaining({ id: MATERIAL_ID, processingStatus: "ready" })]);
    expect(body.knowledgeMap.topics[0]).toMatchObject({
      id: PLAN_TOPIC_ID,
      origin: "material",
      sourceReferences: [{ materialId: MATERIAL_ID, chunkId: CHUNK_ID }],
    });
    expect(mocks.mapMaterial).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("attach_materials_to_plan", {
      payload: expect.objectContaining({
        planId: PLAN_ID,
        materialIds: [MATERIAL_ID],
        knowledgeMap: body.knowledgeMap,
      }),
    });
  });

  it("refuses to invalidate a prepared lesson or its recovery point", async () => {
    mocks.sessionStepData = {
      topicIds: [PLAN_TOPIC_ID],
      generatedSession: { generatedAt: "2026-08-21T12:00:00.000Z" },
      activeSessionCheckpoint: { runId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    };
    mocks.createClient.mockResolvedValue(materialClient());

    const response = await POST(attachRequest());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe("material_attachment_saved_work_protected");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("repairs a legacy Ready staging row with missing mapping before attachment", async () => {
    const client = materialClient({ mappingReady: false });
    mocks.createClient.mockResolvedValue(client);
    mocks.mapMaterial.mockImplementationOnce(async () => {
      client.__stagedMaterial.metadata = {
        mappingStatus: "ready",
        materialUnderstanding: understanding(),
      };
    });

    const response = await POST(attachRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.knowledgeMap.topics[0].sourceReferences).toEqual([
      expect.objectContaining({ materialId: MATERIAL_ID, chunkId: CHUNK_ID }),
    ]);
    expect(mocks.mapMaterial).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("fails closed when a legacy Ready row cannot be durably mapped", async () => {
    const client = materialClient({ mappingReady: false });
    mocks.createClient.mockResolvedValue(client);
    mocks.mapMaterial.mockRejectedValueOnce(new Error("mapping timeout"));

    const response = await POST(attachRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.code).toBe("material_mapping_incomplete");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("uses an authoritative readback after a committed response is lost", async () => {
    const client = materialClient({ attached: true, planKnowledgeMap: reconciledMap() });
    mocks.createClient.mockResolvedValue(client);
    mocks.rpc.mockResolvedValueOnce({ data: { malformed: true }, error: null });

    const response = await POST(attachRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.materials).toEqual([materialResponse()]);
    expect(body.knowledgeMap).toEqual(reconciledMap());
    expect(mocks.mapMaterial).not.toHaveBeenCalled();
  });

  it("does not report a transport-ambiguous attachment as unsaved", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("connection closed after request"));

    const response = await POST(attachRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      code: "material_attachment_outcome_unconfirmed",
      committed: true,
    });
    expect(body.error).toContain("Do not add them again yet");
  });
});

function materialClient(options: {
  mappingReady?: boolean;
  attached?: boolean;
  planKnowledgeMap?: PlanKnowledgeMap;
} = {}) {
  const stagedMaterial = {
    id: MATERIAL_ID,
    filename: "hash-table-notes.md",
    mime_type: "text/markdown",
    byte_size: 2_048,
    processing_status: "ready",
    extracted_text: "Separate chaining and open addressing resolve collisions in hash tables.",
    metadata: options.mappingReady === false ? {} : {
      mappingStatus: "ready",
      materialUnderstanding: understanding(),
    },
  };
  const plan = {
    id: PLAN_ID,
    learning_item_id: ITEM_ID,
    status: "active",
    knowledge_map: options.planKnowledgeMap ?? map(),
  };
  const attachedMaterial = {
    ...stagedMaterial,
    learning_item_id: ITEM_ID,
    metadata: {
      mappingStatus: "ready",
      materialUnderstanding: understanding(),
    },
  };
  const rows = {
    plans: [plan],
    learning_items: [{ id: ITEM_ID, source_mode: "user_materials" }],
    plan_sessions: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", status: "ready", step_data: mocks.sessionStepData }],
    material_uploads: options.attached ? [] : [stagedMaterial],
    materials: options.attached ? [attachedMaterial] : [] as Array<Record<string, unknown>>,
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    from: vi.fn((table: keyof typeof rows) => query(rows[table])),
    rpc: mocks.rpc,
    __stagedMaterial: stagedMaterial,
  };
}

function query(sourceRows: Array<Record<string, unknown>>) {
  let selected = [...sourceRows];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((field: string, value: unknown) => {
      if (selected.some((row) => field in row)) selected = selected.filter((row) => row[field] === value);
      return builder;
    }),
    in: vi.fn((field: string, values: unknown[]) => {
      selected = selected.filter((row) => values.includes(row[field]));
      return builder;
    }),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data: selected[0] ?? null, error: null })),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve({ data: selected, error: null }).then(resolve, reject)
    ),
  };
  return builder;
}

function attachRequest() {
  return new Request("https://yova.example/api/materials/attach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: PLAN_ID, materialIds: [MATERIAL_ID] }),
  });
}

function map(): PlanKnowledgeMap {
  return {
    version: 1,
    scopeJudgment: {
      band: "focused_skill",
      label: "Hash table collisions",
      minimumSessions: 1,
      recommendedSessions: 2,
      maximumSessions: 3,
      minimumTeachingSessions: 1,
      explanation: "The learner needs one bounded comparison followed by an independent application.",
    },
    topics: [{
      id: PLAN_TOPIC_ID,
      title: "Hash table collision strategies",
      description: "Explain and compare separate chaining and open addressing after a key collision.",
      subtopics: ["Separate chaining", "Open addressing"],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [],
      origin: "ai_generated",
      deferred: null,
    }],
    placementCheck: { status: "available", completedAt: null, demonstratedTopicIds: [], gapTopicIds: [] },
  };
}

function reconciledMap(): PlanKnowledgeMap {
  const current = map();
  return {
    ...current,
    topics: current.topics.map((topic) => ({
      ...topic,
      origin: "material" as const,
      sourceReferences: understanding().topics[0].sourceReferences,
    })),
  };
}

function materialResponse() {
  return {
    id: MATERIAL_ID,
    name: "hash-table-notes.md",
    mimeType: "text/markdown",
    sizeBytes: 2_048,
    textContent: null,
    processingStatus: "ready",
  };
}

function understanding(): MaterialUnderstanding {
  return {
    version: 1,
    role: "content_source",
    roleReason: "The source contains explanations and examples that teach collision handling.",
    mixedSections: [],
    chunkCount: 1,
    mappedAt: "2026-08-21T12:00:00.000Z",
    topics: [{
      id: MATERIAL_TOPIC_ID,
      title: "Collision resolution in hash tables",
      description: "Compare separate chaining and open addressing when hash keys collide.",
      subtopics: ["Separate chaining", "Open addressing"],
      prerequisiteTopicIds: [],
      status: "not_started",
      initialEvidence: null,
      sourceReferences: [{
        materialId: MATERIAL_ID,
        chunkId: CHUNK_ID,
        chunkIndex: 0,
        startCharacter: 0,
        endCharacter: 800,
        locationLabel: "Characters 1-800",
        sectionRole: "content_source",
      }],
      origin: "material",
      deferred: null,
    }],
  };
}
