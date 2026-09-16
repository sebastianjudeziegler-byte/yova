import { z } from "zod";
import { defaultEvidence, EXAMPLE_CLAIM_RULE_IDS, ruleEvidence, type HappenedInSession, type RuleEvidence } from "@/lib/routing/rule-evidence";
import type { SessionRoute } from "@/lib/routing/session-route";

/**
 * The hub's YOVA tip (Brief 1.5 item 6; handoff session-hub-3a.md). One tip
 * per step: an instruction, then one sentence of reason. The reason draws on
 * routing evidence for a rule that fired, and the tip is written in the same
 * slot call as the step's content, never in a call of its own.
 */
export const TIP_STEPS = ["study", "produce", "compare", "repair", "brief", "questions", "round", "end"] as const;
export type TipStep = (typeof TIP_STEPS)[number];

const RuleIdSchema = z.string().trim().min(2).max(120);

/** Sent with a slot request: which steps this call writes tips for, and the reasons each may draw on. */
export const TipRequestSchema = z.array(z.object({
  step: z.enum(TIP_STEPS),
  reasons: z.array(z.object({
    ruleId: RuleIdSchema,
    head: z.string().trim().min(2).max(160),
    sentence: z.string().trim().min(8).max(300),
  }).strict()).min(1).max(8),
}).strict()).max(5).default([]);
export type TipRequest = z.infer<typeof TipRequestSchema>;

/** What the model writes per tip. */
export const TipDraftSchema = z.object({
  step: z.enum(TIP_STEPS),
  title: z.string().trim().min(8).max(90),
  body: z.string().trim().min(12).max(280),
  ruleId: RuleIdSchema,
}).strict();
export type TipDraft = z.infer<typeof TipDraftSchema>;

export const SessionTipSchema = TipDraftSchema.extend({ origin: z.enum(["generated", "template"]) }).strict();
export type SessionTip = z.infer<typeof SessionTipSchema>;

/** The handoff's tip table: style exemplars for the prompt, not shipped copy. */
export const TIP_EXEMPLARS: Record<TipStep, ReadonlyArray<{ title: string; body: string }>> = {
  study: [{ title: "Follow one glucose end to end.", body: "You come back with the right terms in the wrong order. Track a single molecule through the ten steps before you look at anything else on the page." }],
  produce: [{ title: "Write \"because\" after every step.", body: "Feynman asks for causes because a step list can be recited without understanding. If a sentence has no because, it is not finished yet." }],
  compare: [{ title: "Attempt the repair before you reread.", body: "Naming a gap is not closing it. Try the fix from memory first. Rereading now will feel like learning and will not stick." }],
  repair: [{ title: "Fix only the two named lines.", body: "Rewriting the whole explanation feels productive and teaches you least. The named gaps are the only part that is still open." }],
  brief: [{ title: "Read it once. Do not reread.", body: "This block exists to give you a model, not to be memorised. The questions were written from it, so a second pass buys you nothing." }],
  questions: [{ title: "Commit to an answer before you look.", body: "Active Recall only pays off if you produce the answer first. Say it, then read the options, not the other way round." }],
  round: [{ title: "A second round is the method working.", body: "Round 2 covers only what you missed. That is the design, not a penalty. The misses are what still needs the retrieval." }],
  end: [
    { title: "Say it out loud once tonight.", body: "One spoken retelling before you sleep is the cheapest spacing you have, and it catches the parts you skipped in writing." },
    { title: "Let the spacing do the rest.", body: "Retrieval you never return to fades. Your next round is already placed four days out. Do not pull it forward tonight." },
  ],
};

/** Which fired rules are relevant to which step, most relevant first. A trailing dot matches a family. */
const STEP_RULES: Record<TipStep, readonly string[]> = {
  study: ["L3.q5.concrete_example", "L3.q10.examples_before_ready", "L2.demonstrated", "L3.q5.try_then_feedback", "L4.q9.extra_reading_time", "L3.q5.step_by_step", "L4.q9.simpler_repeated_instructions", "L1.temporary.shape_b_not_built", "L3.q6."],
  produce: ["C2.q9_visual_overrides_q6", "L3.q6.", "L3.q5.try_then_feedback", "L3.q5.step_by_step", "L4.q9.simpler_repeated_instructions"],
  compare: ["L3.q5.try_then_feedback", "C2.q9_visual_overrides_q6", "L3.q6.", "L4.q9.frequent_check_ins"],
  repair: ["L4.q9.frequent_check_ins", "L4.q9.simpler_repeated_instructions", "C2.q9_visual_overrides_q6", "L3.q6."],
  brief: ["L2.learner_reported_covered", "L4.q9.extra_reading_time", "L4.q9.simpler_repeated_instructions", "L4.practice.", "L4.mix."],
  questions: ["L4.practice.practice_test.", "C7.", "L4.practice.interleaved_review.", "L4.q7.", "L3.q6.answer_questions", "L4.q9.shorter_sections", "L4.practice.active_recall.", "L4.mix."],
  round: ["L4.practice.error_repair.", "L4.q10.forget_during_tests", "L4.q7.", "L4.mix."],
  end: ["L4.q10.forget_during_tests", "L4.q3.", "L4.q9.frequent_check_ins", "L4.q9.shorter_sections", "L4.q2."],
};

const matches = (pattern: string, ruleId: string) => (pattern.endsWith(".") ? ruleId.startsWith(pattern) : ruleId === pattern);

function reasonsForStep(step: TipStep, evidence: RuleEvidence[], route: SessionRoute): RuleEvidence[] {
  const relevant = STEP_RULES[step].flatMap((pattern) => evidence.filter((entry) => matches(pattern, entry.ruleId)));
  const unique = [...new Map(relevant.map((entry) => [entry.ruleId, entry])).values()];
  const general = evidence.filter((entry) => !entry.ruleId.startsWith("L4.practice.") && !entry.ruleId.startsWith("L4.mix."));
  // The task default closes every list, so a step keeps an honest reason when the others cannot be used.
  return [...(unique.length ? unique : general).slice(0, 7), defaultEvidence(route)];
}

/** Built on the client from the route: the steps a slot call writes tips for. */
export function tipRequest(route: SessionRoute, steps: readonly TipStep[], happened: HappenedInSession = {}): TipRequest {
  const evidence = ruleEvidence(route, happened);
  return steps.slice(0, 5).map((step) => ({ step, reasons: reasonsForStep(step, evidence, route) }));
}

/** An instruction per step when the model's tip cannot be used; the reason is the evidence sentence itself. */
const TEMPLATE_TITLE: Record<TipStep, string> = {
  study: "Study for how it works, not for the terms.",
  produce: "Close the material before you start.",
  compare: "Read each named gap before you move on.",
  repair: "Fix only what was named.",
  brief: "Read it once, then go to the questions.",
  questions: "Commit to an answer before you read the options.",
  round: "Answer only what you missed.",
  end: "Come back when the next session is due.",
};

const claimsExample = (ruleId: string, happened: HappenedInSession) => happened.exampleShown === false && EXAMPLE_CLAIM_RULE_IDS.has(ruleId);

/**
 * Binds drafted tips to requested steps. A tip survives only for a requested
 * step, once, on a reason offered for that step; anything else becomes the
 * template tip on the step's first usable reason. Runs on the server.
 */
export function settleTips(requested: TipRequest, drafts: readonly TipDraft[], happened: HappenedInSession = {}): SessionTip[] {
  return requested.flatMap<SessionTip>(({ step, reasons }) => {
    const usable = reasons.filter((reason) => !claimsExample(reason.ruleId, happened));
    const allowed = new Set(usable.map((reason) => reason.ruleId));
    // The first draft for the step on an offered reason; any later one for the same step is ignored.
    const draft = drafts.find((candidate) => candidate.step === step && allowed.has(candidate.ruleId)) ?? null;
    if (draft && !(happened.exampleShown === false && /example/i.test(`${draft.title} ${draft.body}`))) {
      return [{ ...draft, origin: "generated" as const }];
    }
    const reason = usable[0];
    if (!reason) return [];
    return [{ step, title: TEMPLATE_TITLE[step], body: reason.sentence, ruleId: reason.ruleId, origin: "template" as const }];
  });
}

/** The tip part of a slot prompt; empty when the call writes no tips. */
export function tipInstructions(steps: readonly TipStep[]) {
  if (!steps.length) return "";
  const exemplars = steps.flatMap((step) => TIP_EXEMPLARS[step].map((example) => `[${step}] ${example.title} ${example.body}`)).join(" | ");
  return `tips: one tip for each entry in input.tips, with step set to that entry's step. title is one direct instruction for that step of this session, under 12 words. body is ONE sentence of reason, under 35 words, that draws only on one of that entry's reasons: set ruleId to that reason's ruleId, and do not add any fact about the learner the reason does not state. Coach-like and direct; no rule ids, labels or hedging in the text. Match the style of these examples without copying them: ${exemplars}`;
}

/** The tip the screen may show: only for the current step, and only on a rule in route.ruleIds. */
export function visibleTip(tips: Partial<Record<TipStep, SessionTip>>, step: TipStep | null, route: SessionRoute): SessionTip | null {
  const tip = step ? tips[step] : undefined;
  return tip && route.ruleIds.includes(tip.ruleId) ? tip : null;
}
