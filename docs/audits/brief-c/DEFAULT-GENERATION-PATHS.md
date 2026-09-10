# Brief C — default generation and runtime boundaries

Status: starting-source inventory at `971e258`. This is not a claim that source-first behavior has shipped.

## Current entry points

| Entry point | Current behavior | Brief C boundary |
| --- | --- | --- |
| `src/app/api/sessions/generate/route.ts` authenticated handler | Resolves committed route/topic IDs, mapped source chunks, saved profile and runtime context; calls `generateProductionSessionWithOpenAI`; validates route compatibility and persists a generated resource through `cache_generated_session`. | Select block contents from the existing route and usable topic sources; retain ownership, exact-topic, route-revision, and atomic cache protections. Do not revise the plan from this handler. |
| Same file, `generateBrowserPreviewSession` | Preview generation calls the same production generator when live provider mode is enabled. | Preview and production need the same content policy; deterministic previews must not be mistaken for provider evidence. |
| `src/lib/openai/session-generation-strategy.ts` | Chooses streamed teaching, reliable generation, or full generation. Source existence is not currently the deterministic condition deciding whether to teach an AI lesson. | Default AI teaching must have one policy condition: learn/unlearned and no usable source. Sourced learn and practice-only blocks must not fall through to AI lessons. |
| `src/app/api/sessions/lesson/route.ts` plus `GuidedSession` in `src/components/yova-prototype.tsx` | A `lessonBrief` causes streamed instruction to open; previously saved lesson content is reviewable. | Only an `ai_explanation` default step should open the default lesson stream. Reviewing saved legacy work must remain possible. Targeted help is optional and does not replace/reset the block. |
| `src/lib/session-generation/source-grounded-degraded.ts` | A last-resort fallback for narrowly scoped mapped material, still expressed as a generated lesson/practice resource. | This fallback is not the source-first default. Do not weaken its legacy protections merely to reuse it for new block contents. |

## Existing persistence and evidence boundaries to retain

- `src/lib/session-generation/resource.ts`: cached resource decoding/conversion must preserve the activity set on reload. New block metadata must survive this boundary, not only first render.
- `src/lib/learning/active-session-checkpoint.ts`: route/resource fingerprints, immutable progress histories, completion windows, and privacy restrictions protect leave/resume. Checkpoints are progress, not a scoring authority.
- `src/lib/learning/session-activity-progress.ts`: the deployed method-specific nested marker currently covers retrieval rounds only. Block progress must not be passed through it and silently discarded.
- `src/app/api/sessions/evaluate/route.ts`: current answer evaluation returns feedback; it does not itself persist an authoritative block result. Brief C must establish server-owned checked results for new blocks instead of trusting a returned verdict resubmitted by a browser.
- `src/lib/supabase/learning-state-repository.ts` and `complete_plan_session_with_route`: existing runtime completion writer transports results and advances progress. Source completion must remain distinct from practice evidence and cannot bypass the required practice check.
- `src/lib/diagnostics/map-diagnostic.ts`: the Sept 7 placement validator independently solves questions without the answer key and checks ambiguity, factual accuracy, topic alignment, and independence. This is the existing semantic-review pattern to extend only after the founder's validator decision.

## Plan revision boundary

Brief B's inventory remains authoritative: `docs/audits/brief-b/MUTATION-PATHS.md`. Its composition/revision pipeline, map delta, session IDs/order/times, explicit edits, and revision guarding are unchanged by this preparation. Runtime resource/checkpoint/evaluation/completion work belongs to the listed runtime exception. Any necessary change to the composition/revision pipeline requires a separate, concrete founder approval before editing it.

Source resolution must honor existing `sourceReferences`, `attachedSources`, and committed `sourceRequirements`. A mixed sourced/unsourced plan must not bypass source ownership checks or silently reinterpret a committed source binding. Confirm compatibility during implementation; if correction requires changing what the revision pipeline commits, stop and ask.
