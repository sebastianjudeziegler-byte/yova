# Brief C — default generation and runtime boundaries

Implementation inventory; CI closeout remains recorded separately in EVIDENCE.md.

## Default lesson generation

There is one policy for newly prepared work: `planBlockContents` assigns an `ai_explanation` only to a learn-mode topic with no assigned usable source. `generateWorkBlock` asks the provider for explanation text only for those topic IDs. Sourced learn work starts with its named source section; covered/evidenced work starts with practice. Both can request optional targeted help.

| Entry | Content or mutation boundary |
| --- | --- |
| `src/app/api/sessions/generate/route.ts` (authenticated and development-preview handlers) | Resolves existing route, ordered topic IDs, owned source sections and profile; calls the same production block generator. Does not compose or revise sessions. Saves reviewed content and private answer keys before returning the public resource. |
| `src/lib/openai/session-generation-strategy.ts` → `session-blocks/production-result.ts` → `generate.ts` → `plan.ts` | One block preparation path. Code owns source/explanation/practice order, question IDs/count/formats, source/topic binding and profile support. The existing configured lesson-content model fills fixed content slots (50-second maximum); a separate call reviews the whole candidate once (25-second maximum, no retry). Failure returns to recovery without an automatic retry. |
| `src/app/api/sessions/block/explanation/route.ts` | Streams the already reviewed, saved explanation. No provider call, regeneration, semantic recheck or progress mutation. Rejects sourced/practice/foreign activities. |
| `src/app/api/tutor/route.ts` | Optional targeted help requested inside a step. Does not replace the block or its prepared questions. |
| `src/app/api/sessions/lesson/route.ts` | Compatibility for previously saved V16/V17 lesson briefs and saved-lesson review. Existing legacy streaming/fallback remains available for those historical resources. New V19 blocks never enter this path. This historical exception is retained for the explicit no-regression requirement. |
| `reliable-session-generator.ts`, `session-generator.ts`, `streamed-teaching-generator.ts`, `source-grounded-degraded.ts` | Legacy generators/validators remain directly callable by existing permanent canaries and the explicit test-only legacy harness. They are not selected by the production generator for new work. No negative protection was removed to make the new default pass. |

## Runtime writes and evidence

- `save_session_work_block_v1`: server-only preparation; immutable reviewed block and answer key, exact session/route ownership, existing cache guard retained.
- `save_session_work_block_progress_v1`: server-only compare-and-save progress; state/resume do not regenerate or re-review. Source ticks and explicit continuation after requested help are progress only; continued items remain assisted/unscored and create no learning evidence. Raw answers are checked against the saved private key; client verdicts and evidence are rejected.
- Existing `complete_plan_session_with_route`: for V19, requires the completed private ledger and replaces request scores/evidence with the server summary. Source completion alone cannot complete a block. Existing legacy completion remains.
- Existing session checkpoint/progress writer: protects in-progress work, stores actual block step counts; it is not scoring authority.

## Plan revision boundary

Brief B's [write-path inventory](../brief-b/MUTATION-PATHS.md) remains authoritative. Creation and revision use its single fixed-envelope pipeline: map/calendar delta → `composeNormalPlanEnvelopes` → provider copy fill → materialize. Brief C does not add a composition or revision path. Method-choice, scheduling, activation and runtime writers remain the documented exceptions.

The founder explicitly approved one source-only correction: topic-scoped source requirements in the existing envelope-to-route integration, plus the matching source-contract and database projection checks. Unsourced topics cannot inherit another topic's materials. Foreign/missing sources still fail closed. Source revision preserves every other session byte-for-byte. No count/order/timing/method/revision algorithm change is included.
