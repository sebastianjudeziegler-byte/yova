import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningPlan } from "@/lib/domain";
import { DELTA_NOW, deltaFixture, deltaTopicId, deterministicDeltaPlan } from "@/evals/personalization-delta-fixture";
import { buildScaffoldProgressionSignals } from "@/lib/learning/scaffold-progression";
import { buildPracticeVariationContract } from "@/lib/learning/practice-variation";
import { diagnosticResponsesFromMap } from "@/lib/diagnostics/placement-summary";
import { normalizePlanDraftGenerationContract } from "@/lib/plan-generation/draft-contract";
import { composeNormalPlanEnvelopes } from "@/lib/plan-generation/normal-plan-envelopes";
import { buildNormalPlanFromFixedEnvelope } from "@/lib/plan-generation/normal-plan-pipeline";
import { buildNormalPlanFallbackFill } from "@/lib/plan-generation/normal-plan-provider-fill";
import { PlanActivationRequestSchema } from "@/lib/plan-generation/schema";
import { issuePlanDraftReceipt } from "@/lib/server/plan-draft-receipt";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  client: vi.fn(), context: vi.fn(), fill: vi.fn(), rpc: vi.fn(), reserve: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/server/development-preview", () => ({ isDevelopmentPreviewRequest: () => false }));
vi.mock("@/lib/study-route/duration-context-server", async importOriginal => ({
  ...await importOriginal<object>(), loadAuthorizedNormalDurationContext: mocks.context,
}));
vi.mock("@/lib/openai/config", async importOriginal => ({
  ...await importOriginal<object>(), isOpenAIPlanConfigured: () => true,
}));
vi.mock("@/lib/openai/normal-plan-fill-generator", async importOriginal => ({
  ...await importOriginal<object>(), generateNormalPlanFillWithOpenAI: mocks.fill,
}));
vi.mock("@/lib/server/ai-usage", async importOriginal => ({
  ...await importOriginal<object>(), reserveAIRequest: mocks.reserve,
  settleAIRequestClaim: vi.fn().mockResolvedValue(true),
  refundAIRequestClaimBeforeProvider: vi.fn().mockResolvedValue(true),
}));

import { commitPlanStudyRoutes } from "@/lib/study-route/activation";
import { PATCH } from "@/app/api/plans/adjust/route";

const USER = "11111111-1111-4111-8111-111111111111";
const ETC = deltaTopicId(4);
const ENZYMES = deltaTopicId(1);
const VIDEO = "https://www.youtube.com/watch?v=example-biology";
type Operation = Record<string, unknown>;

function savedProfile(profile: 1 | 2) {
  const fixture = deltaFixture(profile);
  mocks.context.mockResolvedValue({
    status: "ready", reason: "loaded", ...fixture.durationContext,
    profileSummary: fixture.request.profileSummary,
    methodProfileVersion: fixture.methodContext.profileVersion,
    methodEvidence: { personalization: fixture.methodContext.personalization, observedEvidence: [] },
  });
}

function contextFor(plan = deterministicDeltaPlan(1), profile: 1 | 2 = 1) {
  const generationRequest = { ...deltaFixture(profile).request, knowledgeMap: plan.knowledgeMap };
  const { receipt } = issuePlanDraftReceipt({
    parsedPlan: plan,
    normalizedGenerationContract: normalizePlanDraftGenerationContract(generationRequest, plan),
    authenticatedUserId: USER,
    issuedAt: DELTA_NOW.toISOString(),
    expiresAt: new Date(DELTA_NOW.getTime() + 3_600_000).toISOString(),
  });
  return { kind: "draft", plan, generationRequest, draftReceipt: receipt };
}

async function preview(operations: Operation[], options: {
  context?: ReturnType<typeof contextFor>;
  controls?: Record<string, unknown>;
  fixedEvents?: Array<Record<string, unknown>>;
} = {}) {
  const context = options.context ?? contextFor();
  const response = await PATCH(new Request("http://localhost/api/plans/adjust", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "preview", context, delta: { operations }, ...options }),
  }));
  const body = await response.json();
  return { response, body, before: context.plan };
}

function topic(plan: LearningPlan, id: string) {
  return plan.knowledgeMap!.topics.find(item => item.id === id)!;
}
function firstSession(plan: LearningPlan, id: string) {
  return plan.sessions.find(session => session.topicIds?.includes(id))!;
}
function assertUnchangedOtherSessions(before: LearningPlan, after: LearningPlan, affectedIds: string[], allowSequenceInsertion = false) {
  for (const session of before.sessions.filter(item => !affectedIds.some(id => item.topicIds?.includes(id)))) {
    const updated = after.sessions.find(item => item.id === session.id);
    expect(updated).toBeDefined();
    if (allowSequenceInsertion) {
      // An inserted block can renumber future ordinal metadata. Every actual
      // session field, including id/time/method/copy and route, stays exact.
      expect({ ...updated, sequence: session.sequence }).toEqual(session);
    } else expect(updated).toEqual(session);
  }
}

describe("living-plan structured preview through the existing adjustment route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(DELTA_NOW);
    vi.stubEnv("YOVA_DRAFT_RECEIPT_SECRET", "living-plan-contract-test-secret-0123456789-abcdef");
    vi.stubEnv("YOVA_PERSONALIZATION_ROLLOUT_PERCENT", "100");
    vi.clearAllMocks();
    // Draft authority comes from the real receipt verifier. There is no active
    // plan or fixed event in this test database unless a case supplies one.
    const read = () => {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        limit: () => chain, not: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return chain;
    };
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) }, from: read, rpc: mocks.rpc });
    mocks.reserve.mockResolvedValue({ allowed: true, claimId: "22222222-2222-4222-8222-222222222222", remainingToday: 9 });
    mocks.fill.mockImplementation(async input => ({
      fill: buildNormalPlanFallbackFill(input), model: "deterministic-provider-fixture", responseId: "fixture",
      generationStats: { attempts: 1, elapsedMs: 0, firstAttemptPassed: true, failedValidator: null, repairAttempted: false, repairSucceeded: null, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    }));
    savedProfile(1);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("shows Practice for learned-elsewhere ETC without claiming a demonstrated result or changing another session", async () => {
    const { response, body, before } = await preview([{ op: "mark_covered", topic_id: ETC }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe("preview");
    const after = body.proposal.after as LearningPlan;
    expect(firstSession(before, ETC).learningMode).toBe("learn");
    expect(firstSession(after, ETC).learningMode).toBe("study");
    expect(topic(after, ETC).initialEvidence).toEqual({ source: "learner_report", outcome: "covered_elsewhere", checked: false });
    expect(topic(after, ETC).status).toBe("not_started");
    expect(after.knowledgeMap!.placementCheck).toEqual(before.knowledgeMap!.placementCheck);
    expect(diagnosticResponsesFromMap(after.knowledgeMap, [])).toEqual([]);
    expect(firstSession(after, ETC).methodReason).toMatch(/hint|example|focus|short/i);
    expect(body.proposal.lines.map((line: { description: string }) => line.description).join(" ")).toMatch(/electron transport chain/i);
    expect(body).not.toHaveProperty("receipt");
    assertUnchangedOtherSessions(before, after, [ETC]);
    const laterPractice = before.sessions.filter(session => session.topicIds?.includes(ETC) && session.id !== firstSession(before, ETC).id);
    for (const session of laterPractice) expect(after.sessions.find(item => item.id === session.id)).toEqual(session);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps a reported topic in Practice and uses brief targeted support after its first real miss", async () => {
    const { response, body } = await preview([{ op: "mark_covered", topic_id: ETC }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const after = body.proposal.after as LearningPlan;
    const reported = topic(after, ETC);
    expect(firstSession(after, ETC).learningMode).toBe("study");
    const beforeCheck = buildPracticeVariationContract({ topics: [reported], conceptSignals: [], scaffoldSignals: [], calibrationSignals: [], maximumChecks: 2 });
    expect(beforeCheck.directives[0]).toMatchObject({ evidenceStatus: "unknown", requiredIntent: "baseline" });
    const measured = buildScaffoldProgressionSignals([{
      completedAt: DELTA_NOW.toISOString(),
      conceptEvidence: [{ topicId: ETC, concept: reported.title, outcome: "needs_review", activityType: "free_response", methodPhase: "independent_practice" }],
    }]);
    const repair = buildPracticeVariationContract({ topics: [reported], conceptSignals: [], scaffoldSignals: measured, calibrationSignals: [], maximumChecks: 2 });
    expect(repair.directives[0]).toMatchObject({ topicId: ETC, evidenceStatus: "gap", requiredIntent: "supported_recheck", openingSupport: "supported" });
    expect(repair.directives[0]!.reason).toMatch(/brief support before checking again/i);
    expect(repair.maximumChecks).toBe(2);
    expect(repair.directives).toHaveLength(1);
    expect(firstSession(after, ETC).learningMode).toBe("study");
  });

  it("attaches the chosen URL to one existing topic and reassesses only that topic's future work", async () => {
    const { response, body, before } = await preview([{ op: "attach_source", topic_id: ENZYMES, url: VIDEO }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const after = body.proposal.after as LearningPlan;
    expect(after.id).toBe(before.id);
    expect(after.knowledgeMap!.topics).toHaveLength(before.knowledgeMap!.topics.length);
    expect(topic(after, ENZYMES)).toHaveProperty("attachedSources", [{ url: VIDEO }]);
    expect(firstSession(after, ENZYMES).estimatedMinutes).toBeGreaterThanOrEqual(firstSession(before, ENZYMES).estimatedMinutes);
    expect(body.proposal.lines.map((line: { description: string }) => line.description).join(" ")).toMatch(/source.*enzymes|enzymes.*source/i);
    assertUnchangedOtherSessions(before, after, [ENZYMES]);
    for (const session of before.sessions.filter(item => item.topicIds?.includes(ENZYMES) && item.id !== firstSession(before, ENZYMES).id)) {
      expect(after.sessions.find(item => item.id === session.id)).toEqual(session);
    }
  });

  it("previews a new topic after the chosen topic while leaving existing work byte-identical", async () => {
    const { response, body, before } = await preview([{ op: "add_topic", title: "Chemiosmosis in membranes", description: "Explain how a proton gradient powers ATP synthesis through ATP synthase.", after_topic_id: ETC }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const after = body.proposal.after as LearningPlan;
    const added = after.knowledgeMap!.topics.find(item => item.title === "Chemiosmosis in membranes")!;
    expect(added.id).toMatch(/^[a-f0-9-]{36}$/i);
    expect(after.knowledgeMap!.topics.indexOf(added)).toBe(after.knowledgeMap!.topics.findIndex(item => item.id === ETC) + 1);
    expect(firstSession(after, added.id).title).toMatch(/chemiosmosis/i);
    assertUnchangedOtherSessions(before, after, [], true);
  });

  it("removes only the chosen topic's future work and retains its map history", async () => {
    const { response, body, before } = await preview([{ op: "remove_topic", topic_id: ENZYMES }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const after = body.proposal.after as LearningPlan;
    expect(topic(after, ENZYMES)).toMatchObject({ removed: true });
    expect(after.sessions.filter(item => item.status !== "skipped" && item.topicIds?.includes(ENZYMES))).toHaveLength(0);
    assertUnchangedOtherSessions(before, after, [ENZYMES]);
  });

  it("excluding a preview line leaves that topic and its sessions unchanged", async () => {
    const { response, body, before } = await preview([
      { op: "mark_covered", topic_id: ETC },
      { op: "attach_source", topic_id: ENZYMES, url: VIDEO },
    ], { controls: { excludedOperationIndexes: [1] } });
    expect(response.status, JSON.stringify(body)).toBe(200);
    const after = body.proposal.after as LearningPlan;
    expect(firstSession(after, ETC).learningMode).toBe("study");
    expect(topic(after, ENZYMES)).toEqual(topic(before, ENZYMES));
    assertUnchangedOtherSessions(before, after, [ETC]);
  });

  it("a later deadline preserves every already-fitting session's time, method and copy", async () => {
    const { response, body, before } = await preview([{ op: "set_deadline", iso: "2026-10-12T20:00:00.000Z" }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.proposal.after.deadline).toBe("2026-10-12T20:00:00.000Z");
    expect(body.proposal.after.sessions).toEqual(before.sessions);
    expect(mocks.fill).not.toHaveBeenCalled();
  });

  it("extending weekly availability leaves already-fitting sessions unchanged", async () => {
    const { response, body, before } = await preview([{ op: "set_availability", availability: [{ day: "Every day", window: "Morning", minutes: 150 }] }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.proposal.after.sessions).toEqual(before.sessions);
    expect(body.proposal.generationRequest.availability[0].minutes).toBe(150);
  });

  it("an impossible deadline produces capacity choices without claiming a saved update", async () => {
    const { response, body } = await preview([{ op: "set_deadline", iso: "2026-09-07T08:02:00.000Z" }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.status).toBe("preview");
    expect(body.proposal.capacity.status).toBe("insufficient");
    expect(body.proposal.capacity.choices.map((choice: { label: string }) => choice.label).join(" ")).toMatch(/move a block.*shorten scope.*add time/i);
    expect(body.proposal.canApply).toBe(false);
    expect(body).not.toHaveProperty("receipt");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends only affected fixed slots to the provider", async () => {
    const { response, body } = await preview([{ op: "mark_covered", topic_id: ETC }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(mocks.fill).toHaveBeenCalledOnce();
    const input = mocks.fill.mock.calls[0]![0];
    expect(input.composition.envelopes.every((item: { topicIds: string[] }) => item.topicIds.every(id => id === ETC))).toBe(true);
    expect(input.request.profileSummary).toMatch(/example|hint/i);
  });

  it("keeps prior scored placement evidence when the learner reports learning the topic elsewhere", async () => {
    const fixture = deltaFixture(1);
    const request = structuredClone(fixture.request);
    const measured = { source: "placement_check" as const, outcome: "gap" as const, observedAt: DELTA_NOW.toISOString() };
    request.knowledgeMap!.topics.find(item => item.id === ETC)!.initialEvidence = measured;
    request.knowledgeMap!.placementCheck = { status: "completed", completedAt: DELTA_NOW.toISOString(), demonstratedTopicIds: [], gapTopicIds: [ETC] };
    const composition = composeNormalPlanEnvelopes({ ...fixture, request, learningIntentRecommendation: { intent: "learn", basis: "Use the scored placement gap before independent practice." } });
    const before = buildNormalPlanFromFixedEnvelope({ ...fixture, request, composition, fill: buildNormalPlanFallbackFill({ request, composition }) });
    const { response, body } = await preview([{ op: "mark_covered", topic_id: ETC }], { context: contextFor(before) });
    expect(response.status, JSON.stringify(body)).toBe(200);
    const after = body.proposal.after as LearningPlan;
    expect(firstSession(after, ETC).learningMode).toBe("study");
    expect(topic(after, ETC)).toHaveProperty("placementEvidence", measured);
    expect(after.knowledgeMap!.placementCheck).toEqual(before.knowledgeMap!.placementCheck);
    expect(diagnosticResponsesFromMap(after.knowledgeMap, [])).toEqual(diagnosticResponsesFromMap(before.knowledgeMap, []));
    expect(topic(after, ETC).status).toBe(topic(before, ETC).status);
  });

  it("covered-topic practice visibly varies in amount and support for the two saved profiles", async () => {
    savedProfile(1);
    const first = await preview([{ op: "mark_covered", topic_id: ETC }], { context: contextFor(deterministicDeltaPlan(1), 1) });
    expect(first.response.status, JSON.stringify(first.body)).toBe(200);
    savedProfile(2);
    const second = await preview([{ op: "mark_covered", topic_id: ETC }], { context: contextFor(deterministicDeltaPlan(2), 2) });
    expect(second.response.status, JSON.stringify(second.body)).toBe(200);
    const p1 = firstSession(first.body.proposal.after, ETC);
    const p2 = firstSession(second.body.proposal.after, ETC);
    expect([p1.learningMode, p2.learningMode]).toEqual(["study", "study"]);
    expect(p1.amountLabel).not.toBe(p2.amountLabel);
    expect(p1.studyRoute!.execution.activityLimit).toBeLessThan(p2.studyRoute!.execution.activityLimit);
    expect(p1.studyRoute!.execution.initialSupport).toBe("supported_start");
    expect(p2.studyRoute!.execution.initialSupport).toBe("independent_start");
    expect(p1.methodReason).toMatch(/hint|example|focus|short/i);
    expect(p2.methodReason).toMatch(/own words|explain|direct|hour|reflect/i);
  });

  it.each([
    { op: "mark_covered", topic_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    { op: "mark_covered", topic_id: ETC, initialEvidence: { source: "placement_check", outcome: "demonstrated" } },
    { op: "mark_covered", topic_id: ETC, checked: true },
    { op: "attach_source", topic_id: ETC, url: "javascript:alert(1)" },
    { op: "replace_session", topic_id: ETC, title: "Learn photosynthesis" },
  ])("rejects foreign IDs and evidence/structure injection: %j", async operation => {
    const { response, body } = await preview([operation]);
    expect(response.status, JSON.stringify(body)).toBe(422);
    expect(mocks.fill).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("commits a reviewed draft and issues a new activation receipt without writing an active plan", async () => {
    const { response, body } = await preview([{ op: "mark_covered", topic_id: ETC }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const applied = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply", proposal: body.proposal, proposalReceipt: body.proposalReceipt }),
    }));
    const result = await applied.json();
    expect(applied.status, JSON.stringify(result)).toBe(200);
    expect(result.status).toBe("applied");
    expect(result.plan.revisionId).toBe(body.proposal.revisionId);
    expect(firstSession(result.plan, ETC).learningMode).toBe("study");
    expect(result.receipt.message).toMatch(/electron transport chain.*everything else unchanged/i);
    expect(result.draftReceipt).toBeTruthy();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an altered preview instead of letting the browser submit a rewritten session", async () => {
    const { response, body } = await preview([{ op: "mark_covered", topic_id: ETC }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    body.proposal.after.sessions[0].title = "Learn photosynthesis under the glycolysis ID";
    const applied = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply", proposal: body.proposal, proposalReceipt: body.proposalReceipt }),
    }));
    const result = await applied.json();
    expect(applied.status).toBe(409);
    expect(result).not.toHaveProperty("receipt");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not apply a preview after its signed authority expires", async () => {
    const { response, body } = await preview([{ op: "mark_covered", topic_id: ETC }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    vi.setSystemTime(new Date(DELTA_NOW.getTime() + 16 * 60_000));
    const applied = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply", proposal: body.proposal, proposalReceipt: body.proposalReceipt }),
    }));
    const result = await applied.json();
    expect(applied.status).toBe(409);
    expect(result).not.toHaveProperty("receipt");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("a fixed event can exhaust capacity without moving it or another existing session", async () => {
    const before = deterministicDeltaPlan(1);
    const context = contextFor(before);
    const fixedEvents = [{ id: "fixed-exam", startsAt: DELTA_NOW.toISOString(), endsAt: "2026-10-30T23:59:00.000Z" }];
    const { response, body } = await preview([{ op: "add_topic", title: "Chemiosmosis in membranes", description: "Explain how a proton gradient powers ATP synthesis." }], { context, fixedEvents });
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.proposal.capacity.status).toBe("insufficient");
    expect(body.proposal.canApply).toBe(false);
    expect(body.proposal.after.sessions).toEqual(before.sessions);
    expect(body).not.toHaveProperty("receipt");
  });

  it("reports a draft's activation capacity before requesting provider copy", async () => {
    const additions = Array.from({ length: 14 }, (_, index) => ({
      op: "add_topic", title: `Membrane investigation ${index + 1}`,
      description: `Explain membrane transport in experimental setting ${index + 1}.`,
    }));
    const { response, body } = await preview(additions);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.proposal.canApply).toBe(false);
    expect(body.proposal.capacity.status).toBe("insufficient");
    expect(body.proposal.capacity.choices.map((choice: { label: string }) => choice.label)).toContain("Shorten scope");
    expect(mocks.fill).not.toHaveBeenCalled();
  });

  it("Undo restores the prior draft revision, session copy and placement evidence with valid activation authority", async () => {
    const { response, body, before } = await preview([{ op: "mark_covered", topic_id: ETC }, { op: "attach_source", topic_id: ENZYMES, url: VIDEO }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const undo = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", planId: before.id, expectedRevisionId: body.proposal.revisionId,
        proposal: body.proposal, proposalReceipt: body.proposalReceipt }),
    }));
    const result = await undo.json();
    expect(undo.status, JSON.stringify(result)).toBe(200);
    expect(result.plan.revisionId).toBe(before.revisionId ?? before.id);
    expect(result.plan.sessions).toEqual(before.sessions);
    expect(result.plan.knowledgeMap).toEqual(before.knowledgeMap);
    expect(result.receipt.message).toMatch(/restored.*everything else unchanged/i);
    expect(result.draftReceipt).toBeTruthy();
  });

  it("Undo of an added topic restores the exact previous map and sessions", async () => {
    const { response, body, before } = await preview([{ op: "add_topic", title: "Energy coupling", description: "Connect ATP hydrolysis to an unfavorable reaction." }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const undo = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", planId: before.id, expectedRevisionId: body.proposal.revisionId,
        proposal: body.proposal, proposalReceipt: body.proposalReceipt }),
    }));
    const result = await undo.json();
    expect(undo.status, JSON.stringify(result)).toBe(200);
    expect(result.plan.sessions).toEqual(before.sessions);
    expect(result.plan.knowledgeMap).toEqual(before.knowledgeMap);
  });

  it("an altered Undo cannot erase an unrelated topic or forge a saved revision", async () => {
    const { body, before } = await preview([{ op: "mark_covered", topic_id: ETC }]);
    body.proposal.before.knowledgeMap.topics.pop();
    const undo = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", planId: before.id, expectedRevisionId: body.proposal.revisionId,
        proposal: body.proposal, proposalReceipt: body.proposalReceipt }),
    }));
    expect(undo.status).toBe(409);
    expect(await undo.json()).not.toHaveProperty("receipt");
  });

  it("rejects a file reference that is not owned, ready and available before requesting provider copy", async () => {
    const { response, body } = await preview([{ op: "attach_source", topic_id: ETC, material_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }]);
    expect(response.status, JSON.stringify(body)).toBe(410);
    expect(body).not.toHaveProperty("proposalReceipt");
    expect(mocks.fill).not.toHaveBeenCalled();
  });

  it("requires a structured reviewed delta instead of executing the retired adjustment payload", async () => {
    const response = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: deterministicDeltaPlan(1).id, deadline: "2026-10-01T23:59:00.000Z", studyMode: "inside_yova", futureSessionMinutes: 25 }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "plan_revision_preview_required" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("attaches an owner-ready file without duplicating topics and Undo restores the previous source list", async () => {
    const materialId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const row = { id: materialId, filename: "ETC notes.txt", mime_type: "text/plain", byte_size: 100,
      processing_status: "ready", expires_at: "2026-09-30T00:00:00.000Z", metadata: {} };
    const read = (table: string) => {
      const chain = { select: () => chain, eq: () => chain, in: () => chain,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "material_uploads" ? [row] : [], error: null }).then(resolve) };
      return chain;
    };
    mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) }, from: read, rpc: mocks.rpc });
    const { response, body, before } = await preview([{ op: "attach_source", topic_id: ETC, material_id: materialId }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(topic(body.proposal.after, ETC).attachedSources).toEqual([{ material_id: materialId }]);
    expect(body.proposal.after.knowledgeMap.topics.map((item: { id: string }) => item.id)).toEqual(before.knowledgeMap!.topics.map(item => item.id));
    expect(body.proposal.lines[0].after.join(" ")).toContain("ETC notes.txt");
    const activation = PlanActivationRequestSchema.safeParse({ plan: body.proposal.after, generationRequest: body.proposal.generationRequest, draftReceipt: "test-shape" });
    expect(activation.success, JSON.stringify(activation)).toBe(true);
    const undo = await PATCH(new Request("http://localhost/api/plans/adjust", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "undo", planId: before.id, expectedRevisionId: body.proposal.revisionId, proposal: body.proposal, proposalReceipt: body.proposalReceipt }) }));
    const restored = await undo.json();
    expect(undo.status, JSON.stringify(restored)).toBe(200);
    expect(restored.plan.materials).toEqual(before.materials);
    expect(restored.generationRequest.materials).toEqual(before.materials);
    expect(topic(restored.plan, ETC).attachedSources).toEqual(topic(before, ETC).attachedSources);
  });

  it("budgets time to study a newly attached source before practice and says so in the preview", async () => {
    const plan = structuredClone(deterministicDeltaPlan(1));
    // Allow an expanded block without asking to move any neighboring session.
    plan.sessions.forEach((session, index) => { session.scheduledFor = new Date(Date.UTC(2026, 8, 8 + index, 9)).toISOString(); });
    const { response, body, before } = await preview([{ op: "attach_source", topic_id: ETC, url: VIDEO }], { context: contextFor(plan) });
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(firstSession(body.proposal.after, ETC).estimatedMinutes).toBeGreaterThan(firstSession(before, ETC).estimatedMinutes);
    expect(body.proposal.lines[0].after.join(" ")).toMatch(/study (?:this |the )?source.*practice/i);
    expect(body.proposal.lines[0].after.join(" ")).toContain(VIDEO);
    const route = firstSession(body.proposal.after, ETC).studyRoute!;
    expect(route.timing.durationSource).not.toBe("learner_override");
    expect(route.provenance.ruleTrace.some(entry => /learner selected 45 minutes/i.test(entry.reason))).toBe(false);
  });

  it("reports limited source study time instead of silently consuming a neighboring block", async () => {
    const { response, body, before } = await preview([{ op: "attach_source", topic_id: ETC, url: VIDEO }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.proposal.capacity.status).toBe("reduced");
    expect(body.proposal.capacity.explanation).toMatch(/source.*time|time.*source/i);
    expect(body.proposal.capacity.choices.map((choice: { label: string }) => choice.label)).toEqual(["Move a block", "Shorten scope", "Add time"]);
    assertUnchangedOtherSessions(before, body.proposal.after, [ETC]);
  });

  it("excluding one line excludes its controls even when another line changes the same topic", async () => {
    const context = contextFor();
    const session = firstSession(context.plan, ETC);
    const result = await preview([{ op: "attach_source", topic_id: ETC, url: VIDEO }, { op: "mark_covered", topic_id: ETC }], { context,
      controls: { excludedOperationIndexes: [0], sessionEdits: [{ sessionId: session.id, operationIndex: 0, durationMinutes: 45 }] } });
    expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.proposal.canApply).toBe(true);
    const revised = firstSession(result.body.proposal.after, ETC);
    expect(revised.learningMode).toBe("study");
    expect(revised.estimatedMinutes).toBeLessThanOrEqual(session.estimatedMinutes);
    expect(topic(result.body.proposal.after, ETC).attachedSources).toBeUndefined();
  });

  it("reviews a chosen calendar duration even when the availability windows stay the same", async () => {
    const context = contextFor();
    const session = firstSession(context.plan, ETC);
    const result = await preview([{ op: "set_availability", availability: context.generationRequest.availability }], { context,
      controls: { excludedOperationIndexes: [], sessionEdits: [{ sessionId: session.id, durationMinutes: 15 }] } });
    expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.proposal.canApply).toBe(true);
    expect(result.body.proposal.lines[0].before.join(" ")).toContain("25 min");
    expect(result.body.proposal.lines[0].after.join(" ")).toContain("15 min");
    expect(result.body.proposal.after.sessions.find((item: { id: string }) => item.id === session.id).estimatedMinutes).toBe(15);
    assertUnchangedOtherSessions(context.plan, result.body.proposal.after, [ETC]);
  });

  it("lets the learner edit the first new topic block before it has a persisted session ID", async () => {
    const context = contextFor();
    const operations = [{ op: "add_topic", title: "Fermentation comparison", description: "Compare fermentation with aerobic respiration after glycolysis.", after_topic_id: deltaTopicId(5) }];
    const initial = await preview(operations, { context });
    expect(initial.response.status).toBe(200);
    const line = initial.body.proposal.lines[0];
    const proposed = initial.body.proposal.after.sessions.find((session: LearningPlan["sessions"][number]) => session.id === line.sessionIds[0]);
    const edited = await preview(operations, { context, controls: { excludedOperationIndexes: [], sessionEdits: [{ operationIndex: 0, scheduledFor: proposed.scheduledFor, durationMinutes: 10 }] } });
    expect(edited.response.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.proposal.canApply).toBe(true);
    const updatedId = edited.body.proposal.lines[0].sessionIds[0];
    const updated = edited.body.proposal.after.sessions.find((session: LearningPlan["sessions"][number]) => session.id === updatedId);
    expect(updated.estimatedMinutes).toBe(10);
    expect(updated.scheduledFor).toBe(proposed.scheduledFor);
    assertUnchangedOtherSessions(context.plan, edited.body.proposal.after, [], true);
  });

  async function activePreview(operations: Operation[], mutate?: (plan: LearningPlan) => void) {
    const plan = commitPlanStudyRoutes({ ...deterministicDeltaPlan(1), status: "active" as const }, DELTA_NOW.toISOString());
    mutate?.(plan);
    mocks.rpc.mockImplementation(async (name: string) => name === "read_plan_revision_context" ? {
      data: { plan, generationRequest: { ...deltaFixture(1).request, knowledgeMap: plan.knowledgeMap },
        protections: [], sessionFingerprints: Object.fromEntries(plan.sessions.map(item => [item.id, "fingerprint-" + item.id])),
      }, error: null,
    } : { data: null, error: { message: "Unexpected database mutation during preview" } });
    const response = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", context: { kind: "active", planId: plan.id, expectedRevisionId: plan.revisionId ?? plan.id }, delta: { operations } }),
    }));
    return { response, body: await response.json(), before: plan };
  }

  it("loads the saved plan on the server and changes only its next unstarted topic session", async () => {
    const { response, body, before } = await activePreview([{ op: "mark_covered", topic_id: ETC }]);
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(firstSession(body.proposal.after, ETC).learningMode).toBe("study");
    assertUnchangedOtherSessions(before, body.proposal.after, [ETC]);
    for (const later of before.sessions.filter(session => session.topicIds?.includes(ETC)).slice(1)) {
      expect(body.proposal.after.sessions.find((session: LearningPlan["sessions"][number]) => session.id === later.id)).toEqual(later);
    }
    expect(mocks.rpc.mock.calls.every(([name]) => name === "read_plan_revision_context")).toBe(true);
    expect(body).not.toHaveProperty("receipt");
  });

  it("lets an existing Study Now goal review its calendar through the same fixed-map pipeline", async () => {
    const result = await activePreview([{ op: "attach_source", topic_id: ETC, url: VIDEO }], plan => {
      plan.creationIntent = "study_now";
      plan.sessions = [firstSession(plan, ETC)];
    });
    expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.proposal.after.sessions).toHaveLength(1);
    expect(result.body.proposal.lines[0].after.join(" ")).toContain(VIDEO);
  });

  it("keeps unrelated completed sessions and in-progress resources byte-identical in an active preview", async () => {
    const { response, body, before } = await activePreview([{ op: "mark_covered", topic_id: ETC }], plan => {
      plan.sessions[0]!.status = "complete";
      // Opaque current work must survive the revision boundary verbatim.
      const unrelated = plan.sessions.find(session => session.status !== "complete" && !session.topicIds?.includes(ETC))!;
      Object.assign(unrelated, { resource: { title: "My saved practice", learnerAnswer: "ATP transfers energy" } });
    });
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.proposal.after.sessions[0]).toEqual(before.sessions[0]);
    assertUnchangedOtherSessions(before, body.proposal.after, [ETC]);
    expect(firstSession(body.proposal.after, ETC).learningMode).toBe("study");
  });

  it("keeps an opened topic session and changes its later unstarted practice instead", async () => {
    const { response, body, before } = await activePreview([{ op: "mark_covered", topic_id: ETC }], plan => {
      Object.assign(firstSession(plan, ETC), { resource: { title: "Already open", learnerAnswer: "Protons accumulate" } });
    });
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(firstSession(body.proposal.after, ETC)).toEqual(firstSession(before, ETC));
    const following = body.proposal.after.sessions.filter((session: LearningPlan["sessions"][number]) => session.topicIds?.includes(ETC)).at(-1);
    expect(following.learningMode).toBe("study");
    expect(following.amountLabel).toMatch(/hints available/);
  });

  it("rejects an obsolete saved-plan revision before offering a preview", async () => {
    const fixture = await activePreview([{ op: "mark_covered", topic_id: ETC }]);
    expect(fixture.response.status, JSON.stringify(fixture.body)).toBe(200);
    mocks.fill.mockClear();
    const response = await PATCH(new Request("http://localhost/api/plans/adjust", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", context: { kind: "active", planId: fixture.before.id, expectedRevisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, delta: { operations: [{ op: "mark_covered", topic_id: ETC }] } }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("proposalReceipt");
    expect(mocks.fill).not.toHaveBeenCalled();
  });

});
