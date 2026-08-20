/**
 * The longest title a generated plan or session draft may carry.
 *
 * Plan and session drafts are validated against this bound, so every producer
 * of a title has to respect it. It previously existed as a literal inside the
 * draft schemas while intake derived titles against a separate, larger limit.
 * Any goal whose derived title landed between the two threw an uncaught
 * validation error inside plan generation, which reached the learner as an
 * empty 500 response rather than a usable plan.
 *
 * Keep this as the single bound. A producer that wants shorter titles should
 * define its own stricter limit below this one rather than raising it.
 */
export const LEARNING_TITLE_CHARACTER_LIMIT = 90;
