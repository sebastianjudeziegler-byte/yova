# Scope and claim crosscheck

Read against `journey-notes.md` and `static-review.md` as available on 17 September 2026, and the shipped specification at commit `b75ec8d3da25695e6b008aa3e5f82855d415298e`. Later live journeys may add evidence. This note changes neither companion report.

The verdict concerns the deployed session experience. Brief 2 is not being assessed as implemented. Its rewritten specification is useful only to identify which proposed work already belongs to that future change.

## Current-session findings that stand independently of Brief 2

| Finding | Scope and defensible claim |
|---|---|
| A: Finish fails twice; S01: draft loss | Both are current session reliability failures. The user should be able to finish and resume the shipped flow regardless of the future plan model. Map draft loss was reproduced live. The Finish symptom is reproduced; its cause is unresolved. |
| S02: comparison recovery; S03: escalation outcomes | Both are current runner defects established by source, with live reproduction still pending. A wrong event dispatch is unrelated to plan generation. Likewise, the completion payload should preserve the already-passed versus unresolved point distinction before any future planner consumes it. |
| S13: false try-first claims | Strong live and static evidence. The actual question-answering route disables try-first but retains its rule and claim. The card, tip and receipt must describe the session that actually ran. This directly conflicts with Brief 1.5's honesty requirement. |
| S05: unimplemented stopping-point/pace effects | Current-session trust issue. Source establishes missing consumers; journey A alone does not prove that no learner could perceive a stopping-point difference. Describe the static wiring precisely, and do not use ordinary Continue buttons as evidence of an added personalized intervention. |
| S08: multiple-choice-only retrieval | Current session limitation, explicitly brief-compliant. Questions can vary in type while remaining recognition-based. Critique fit for the user's intended practice; do not call the absence of typed answers a failed implementation requirement. |
| S09: concept-map interaction | Current session usability gap. Plain concept/link fields and no rendered graph were observed. It is reasonable to find this weak for mapping, especially when selected for visual support. It is not evidence that the comparison model cannot reason about the links; journey A's feedback was useful. |
| S10: unchecked repair | Current session learning-value gap. The deliberately still-wrong repair was accepted without another check. Optional repair is explicitly allowed by the brief, so this is not proof of a pass/fail contract violation. The issue is what the learner gains after choosing to repair and what “Save repair” implies. |
| S12: unsupplied comparable problem | If the currently exposed option asks a learner to solve a problem without providing the problem, that is a defect in the exposed flow. Do not demand the complete deferred Shape B progression as its fix. Live reproduction remains pending in the reviewed notes. |

## Mixed findings: retain observations, separate the future plan work

**Time and depth (S07).** There are two distinct problems. The pre-session card's 25-minute value versus the hub's 11-minute timer in A is an interface mismatch. B's 55-minute timer and 20/25/10-minute sidebar for a short explanation, five MCQs and one retry are misleading expectations about the work. Both are observable now. However, the rewritten Brief 2 explicitly replaces the time-first composer and defines content-derived estimates with the profile answer as a ceiling (`docs/redesign/05-PLAN-MODEL.md:35–54`; `BRIEF-2-plan-model.md:26–39`). Put timer unification and block-duration estimation on that integration/retest list rather than commissioning a conflicting sizing system in this audit. Separately, question challenge, distractor quality, optional harder work and transfer cannot be assumed fixed by new estimates.

The shipped Brief 1 specification explicitly says a timer is a nudge and sessions are not sized to a time slot (`01-SESSION-SHAPES.md:3–6`). Therefore a short session is not, by itself, evidence of violating the shipped spec. The valid product question is whether the app sets honest expectations and provides worthwhile work. Do not prescribe forty minutes of mandatory repetition or punish a learner for finishing quickly.

**No next practice after the map session.** Journey A was a one-off Study Now plan and ended with nothing queued. This supports a critique that its current ending gives little help checking the repair. It does not prove that all normal plans lack follow-up practice. Brief 2 specifies learn blocks plus a practice placeholder per topic (`05-PLAN-MODEL.md:133–140`). Defer judgments about the new queue, spaced scheduling, block coverage and plan progression; retest map-to-practice continuity when that plan model ships.

**Academic target/challenge (S11).** The slot interface's lack of explicit academic-level/challenge/history fields is a current integration limitation. But a topic's prose or supplied material can carry some of that information, and the old plan composer chooses the first topic. A and B received different generated topics despite using the same broad goal. Do not blame session generation alone for dropping every aspect of the broad prompt. Carry an exact learning target and academic context through the future plan/session boundary, then test challenge separately. More topic-derived questions are not the same as harder questions or demonstrated-ability adaptation. Brief 2 itself excludes adaptive routing (`BRIEF-2-plan-model.md:72–75`), so do not promise that it will deliver that capability.

**Escalation's next-method promise (S04).** The visible claim is a current-session honesty problem and can be corrected now. Implementing a new learn block and scheduling its successor touches the plan interface. Either fulfill the narrowly stated promise using the intended plan machinery or remove/reword it; do not silently expand the audit into a plan-model redesign. The reviewed notes do not yet show this path live.

**Interleaved attribution (S06).** Current source loses originating-topic attribution, and Brief 1.5's own evidence explicitly records this limitation for Brief 2 (`docs/audits/brief-1.5/EVIDENCE.md:263–270`). Keep it as a known integration defect to fix and retest when multi-topic outcomes are wired through; do not present it as a newly observed live failure. Its current visible copy must still avoid unsupported mastery claims.

## Overclaims to avoid in the final reports

- Distinguish **live reproduced**, **source-established**, **runtime hypothesis**, and **product judgment**. S02/S03/S04/S06/S12 were not reproduced live in the notes reviewed here.
- Two Finish errors in one session do not establish a global outage or failure rate. A healthy public auth endpoint does not diagnose completion RPC health. The client deadline means confirmation did not arrive; it does not establish whether the server committed. New retry IDs and absent outbox use are robustness concerns, not the proven timeout cause.
- B completed at displayed 5:23/55:00 during an automated audit including inspection and waits. Call that the observed audit duration, not the time all human learners need. The later 7:35 screenshot was taken after the completion screen appeared.
- The current flow does not mandate three rounds. A clean first round may finish; retries target misses. B verifies that a one-point Error Repair round now generates and completes. It does not verify two-point retries, ceiling escalation, or every practice label.
- A versus B is an illustrative profile contrast, not a clean causal personalization experiment: same account/history, different generated first topics, changed multiple profile answers. Do not claim that this alone passes the formal same-topic/same-material delta gate.
- Concept-mapping feedback was specific and correct in A, and B showed a real question-type mix. Do not flatten those successes into “nothing is personalized,” “all questions are recall,” or “all feedback is useless.”
- “Save repair” immediately reaching completion did not make a correctness or mastery claim. Its missing recheck and lack of durable corrected artifact are the narrower concerns.
- Native screenshots were visible in the tool conversation but not exported as local files. Do not cite nonexistent screenshot artifacts or imply a downloadable recording exists.
- Historical quarantine classifications and CI passes are not current production test results. Exclude the retired general-purpose session runtime from the current verdict.
- The status endpoint's legacy `personalization_rollout_v1: 0` value does not show that the active Brief 1/1.5 router is disabled. Actual profile-dependent methods and timers were observed.
- Do not count absent Brief 2 plan composition, richer topic relationships, new ingestion work, or the deferred full Shape B as broken shipped promises. Evaluate any option currently exposed on its own usable behavior.

The strongest current report centers on session reliability, honest personalization, useful practice, usable mapping and whether feedback closes a learning gap. Treat the future plan/session integration as a separate retest list, with no claim that Brief 2 has already solved it.
