import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { LearningPlanSession } from "@/lib/domain";
import { buildDeferredSessionContinuation } from "@/lib/learning/session-continuation";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/202608220002_non_positional_guided_continuations.sql",
  ),
  "utf8",
);

const TOPIC_1 = "00000000-0000-4000-8000-000000000101";
const TOPIC_2 = "00000000-0000-4000-8000-000000000102";
const TOPIC_3 = "00000000-0000-4000-8000-000000000103";

function completedSession(): LearningPlanSession {
  return {
    id: "00000000-0000-4000-8000-000000000110",
    sequence: 1,
    title: "Cellular respiration stages",
    objective: "Learn the stages, locations, and outputs of cellular respiration.",
    method: "Guided explanation and retrieval",
    methodReason: "Build a connected model and then retrieve it independently.",
    scheduledFor: "2026-08-22T12:00:00.000Z",
    estimatedMinutes: 20,
    amountLabel: "Three targets · about 20 min",
    learningMode: "learn",
    topicIds: [TOPIC_1, TOPIC_2, TOPIC_3],
    contentTargets: [
      "Glycolysis inputs and outputs",
      "Krebs cycle location and outputs",
      "Electron transport chain mechanism",
    ],
    completionEvidence: [
      "Explain glycolysis inputs and outputs",
      "Explain the Krebs cycle location and outputs",
      "Explain the electron transport chain mechanism",
    ],
    status: "ready",
    resource: {
      rationale: "One target fits before the next scheduled session.",
      coverage: {
        focus: "Glycolysis inputs and outputs",
        essentialIdeas: ["Glycolysis converts glucose to pyruvate."],
        completionEvidence: ["Explain glycolysis inputs and outputs"],
        evidenceMap: [{
          essentialIdea: "Glycolysis converts glucose to pyruvate.",
          activityConcept: "Glycolysis",
        }],
        deferredContent: [
          "Krebs cycle location and outputs",
          "Electron transport chain mechanism",
        ],
      },
      activities: [],
      generatedAt: "2026-08-22T12:00:00.000Z",
      origin: "generated",
    },
  };
}

describe("non-positional guided-continuation migration", () => {
  it("derives the exact target subset from the cached generated lesson before replay or mutation", () => {
    const targetContract = migration.indexOf(
      "completed_session.step_data #> '{generatedSession,coverage,deferredContent}'",
    );
    const replayLookup = migration.indexOf("into existing_attempt");
    const firstMutation = migration.indexOf("update public.plan_sessions");

    expect(targetContract).toBeGreaterThan(-1);
    expect(migration).toContain(
      "expected_content_targets is distinct from requested_continuation -> 'contentTargets'",
    );
    expect(migration).toContain("regexp_replace(btrim(deferred.value #>> '{}'), '[[:space:]]+', ' ', 'g')");
    expect(targetContract).toBeLessThan(replayLookup);
    expect(replayLookup).toBeLessThan(firstMutation);
    expect(migration).toContain(
      "jsonb_array_length(expected_content_targets) >= jsonb_array_length(original_content_targets)",
    );
    expect(migration).toContain(
      "jsonb_array_length(original_completion_evidence) not between 1 and 4",
    );
    expect(migration).toContain(
      "when cached_deferred_contract_available then cached_deferred_labels",
    );
    expect(migration).toContain(
      "else requested_continuation -> 'contentTargets'",
    );
    expect(migration).toContain(
      "existing_attempt.result_data #> '{continuationSession,contentTargets}'",
    );
    expect(migration).toContain("existing_attempt_found := found;");
    expect(migration).toContain(
      "and not existing_attempt_found",
    );
    expect(migration).toContain(
      "requested_topic_ids is distinct from legacy_topic_ids",
    );
  });

  it("writes the full authoritative topic superset and synthesized checks for the new contract", () => {
    expect(migration).toContain("expected_topic_ids := original_topic_ids;");
    expect(migration).toContain(
      "'Explain or apply this remaining saved target independently: ' || (target.value #>> '{}')",
    );
    expect(migration).toContain("else expected_topic_ids");
    expect(migration).toContain("'contentTargets', expected_content_targets");
    expect(migration).toContain("else expected_completion_evidence");
    expect(migration).toContain(
      "jsonb_array_length(original_topic_ids) = jsonb_array_length(original_content_targets)",
    );
    expect(migration).toContain("where topic.ordinality in");
  });

  it("keeps old-client subsets narrow during DB-first rollout and canonicalizes new-client input", () => {
    const compatibilityBranch = migration.indexOf(
      "persisted_topic_ids := case",
    );
    const canonicalization = migration.indexOf(
      "continuation := requested_continuation || jsonb_build_object(",
    );
    const replayLookup = migration.indexOf("into existing_attempt");
    const insert = migration.indexOf("insert into public.plan_sessions (");

    expect(migration).toContain("requested_topic_ids is distinct from legacy_topic_ids");
    expect(migration).toContain(
      "requested_completion_evidence is distinct from legacy_completion_evidence",
    );
    expect(migration).toContain(
      "jsonb_array_length(original_topic_ids) = jsonb_array_length(original_content_targets)",
    );
    expect(migration).toContain(
      "jsonb_array_length(original_completion_evidence) = jsonb_array_length(original_content_targets)",
    );
    expect(migration).toContain(
      "legacy_client_topic_subset := requested_topic_ids is distinct from expected_topic_ids",
    );
    expect(migration).toContain(
      "when legacy_client_topic_subset then requested_topic_ids",
    );
    expect(migration).toContain(
      "when legacy_client_topic_subset then requested_completion_evidence",
    );
    expect(compatibilityBranch).toBeGreaterThan(-1);
    expect(compatibilityBranch).toBeLessThan(canonicalization);
    expect(canonicalization).toBeGreaterThan(-1);
    expect(replayLookup).toBeLessThan(canonicalization);
    expect(canonicalization).toBeLessThan(insert);
    expect(migration).toContain(
      "canonical_existing_continuation is distinct from continuation",
    );
    expect(migration).toContain(
      "if not legacy_client_topic_subset and existing_continuation_needs_canonicalization then",
    );
    expect(migration).toContain(
      "existing_continuation -> 'topicIds' is distinct from expected_topic_ids",
    );
    expect(migration).toContain("until that runtime has drained");
    expect(migration).toContain(
      "jsonb_set(step_data - 'generatedSession', '{topicIds}', expected_topic_ids, true)",
    );
    expect(migration).toContain("'{continuationSession}',\n      continuation");
  });

  it("matches the browser continuation's full topics, exact targets, and synthesized evidence", () => {
    const continuation = buildDeferredSessionContinuation({
      completedSession: completedSession(),
      completedAt: "2026-08-22T12:10:00.000Z",
      plannedMinutes: 20,
      continuationId: "00000000-0000-4000-8000-000000000120",
    });

    expect(continuation).toMatchObject({
      topicIds: [TOPIC_1, TOPIC_2, TOPIC_3],
      contentTargets: [
        "Krebs cycle location and outputs",
        "Electron transport chain mechanism",
      ],
      completionEvidence: [
        "Explain or apply this remaining saved target independently: Krebs cycle location and outputs",
        "Explain or apply this remaining saved target independently: Electron transport chain mechanism",
      ],
    });
    expect(migration).toContain("expected_topic_ids := original_topic_ids;");
    expect(migration).toContain(
      "'Explain or apply this remaining saved target independently: '",
    );
  });

  it("keeps the serialized scheduling transaction and authenticated boundary", () => {
    expect(migration).toContain("security invoker\nset search_path = ''");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration).toContain("order by session.sequence\n  for update");
    expect(migration).toContain(
      "revoke all on function public.complete_guided_plan_session_with_continuation(jsonb)\nfrom public, anon, authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.complete_guided_plan_session_with_continuation(jsonb)\nto authenticated",
    );
  });

  it("marks only cached active topics taught while retaining the original scope for replay", () => {
    const narrowCompletedScope = migration.indexOf(
      "'{guidedContinuationOriginalScope}'",
    );
    const completion = migration.indexOf(
      "completed_plan_id := public.complete_plan_session(sanitized_payload)",
    );

    expect(migration).toContain(
      "completed_session.step_data #> '{generatedSession,topicIds}'",
    );
    expect(migration).toContain(
      "then preserved_original_scope -> 'topicIds'",
    );
    expect(migration).toContain(
      "where cached_active_topic_ids @> jsonb_build_array(topic.value)",
    );
    expect(migration).toContain(
      "where not (legacy_topic_ids @> jsonb_build_array(topic.value))",
    );
    expect(narrowCompletedScope).toBeGreaterThan(-1);
    expect(narrowCompletedScope).toBeLessThan(completion);
  });

  it("derives taught topics from each cached generated resource and repairs prior monotonic status", () => {
    const refresh = migration.indexOf(
      "create or replace function public.refresh_plan_knowledge_map_topic_statuses(",
    );
    const continuationRpc = migration.indexOf(
      "create or replace function public.complete_guided_plan_session_with_continuation(",
    );

    expect(refresh).toBeGreaterThan(-1);
    expect(refresh).toBeLessThan(continuationRpc);
    expect(migration).toContain(
      "session.step_data #> '{generatedSession,topicIds}'",
    );
    expect(migration).toContain(
      "session.step_data -> 'topicIds'\n                    @> session.step_data #> '{generatedSession,topicIds}'",
    );
    expect(migration).not.toContain(
      "when coalesce(topic.value ->> 'status', 'not_started') = 'taught' then 'taught'",
    );
    expect(migration).toContain(
      "for owned_plan in select id, user_id from public.plans loop",
    );
  });
});
