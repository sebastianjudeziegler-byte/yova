import { onboardingAnswerId, onboardingSupportNeeds, type OnboardingAnswers, type OnboardingSingleAnswerId } from "@/lib/onboarding/answers";
import { onboardingOptionLabel, type OnboardingQuestionId } from "@/lib/onboarding/questions";
import { FUNCTIONAL_SUPPORT_OPTIONS } from "@/lib/sample-data";

/**
 * Brief 2.5 root cause 4 (findings 20, 21, 72, 75, 78): the plan's "why"
 * paragraph was every fired rule's canned reason stitched together - nine
 * sentences, some describing work the plan did not contain ("dense topics
 * stop at three learning blocks" on a plan with no learning blocks) and "a
 * 11-minute". It is now generated from the rule IDs that fired, one sentence
 * per rule, each "Because you said X, YOVA did Y", where X is the learner's own
 * answer and Y is what the composer enacted. A rule the composer did not enact
 * is never fired, so it never reaches this text. Rules that are not about the
 * learner (topic sizing, workload grouping) are not personalization and are
 * left out.
 */
export type PersonalizationSentenceContext = { answers: OnboardingAnswers; ceilingMinutes: number; deadline: string | null; timeZone: string };

type Rule = { question: OnboardingSingleAnswerId & OnboardingQuestionId; said: (label: string) => string; did: (option: string, context: PersonalizationSentenceContext) => string | null };

const quoted = (label: string) => `“${label}”`;
const RULES: Record<string, Rule> = {
  P1: { question: "energy_window", said: label => `your energy is best in the ${label.toLowerCase()}`,
    did: option => `YOVA puts learning blocks in the ${option.replace("_", " ")} and practice in your other study windows` },
  P2: { question: "session_length", said: label => label === "It depends" ? "your session length depends on the task" : `${label.toLowerCase()} feels realistic`,
    did: (_, context) => `YOVA keeps each block to at most ${context.ceilingMinutes} minutes` },
  P3: { question: "focus_loss", said: label => `you lose focus ${label.toLowerCase()}`,
    did: () => "YOVA keeps blocks shorter and never puts two on the same day" },
  P4: { question: "guidance", said: quoted,
    did: option => option === "learner_choice" ? "YOVA keeps the blocks in order and lets you choose their dates"
      : option === "exact_guidance" ? "YOVA gives each block a set date and a clear next step" : "YOVA gives each block a suggested date you can move" },
  P5: { question: "difficulty_help", said: label => `${quoted(label)} helps most`,
    did: option => option === "step_by_step" ? "YOVA plans at most one learning block a day"
      : option === "concrete_example" ? "YOVA brings forward the learning blocks that have a worked example" : null },
  P6: { question: "prove_knowing", said: label => `${label.toLowerCase()} is how you check you know something`,
    did: option => ({ explain_back: "learning blocks end with you explaining the idea back", map_it: "learning blocks end with you mapping how the ideas connect",
      answer_questions: "learning blocks end with questions for you to answer", solve_it: "learning blocks end with a problem for you to work through" } as Record<string, string>)[option] ?? null },
  P7: { question: "gist_detail", said: quoted,
    did: option => option === "gist_leaning" ? "practice leans towards precise recall"
      : option === "detail_leaning" ? "practice leans towards how the ideas fit together" : "practice mixes recall with applying the ideas" },
  P8: { question: "starting_pattern", said: quoted,
    did: option => ["often_delay", "deadline_pressure", "planning_avoidance"].includes(option)
      ? "YOVA makes the first block short and puts it at your next available time" : "YOVA spreads the blocks across your available days" },
  P10: { question: "extra_context", said: quoted,
    did: option => option === "forget_during_tests" ? "YOVA adds an extra practice round for each topic"
      : option === "long_plan_shutdown" ? "YOVA shows only the next block and collapses the rest" : null },
};
const SUPPORT: Record<string, string> = {
  shorter_sections: "YOVA puts less into each block",
  frequent_check_ins: "YOVA brings each topic's first practice check forward by a day",
};
const DEADLINE: Record<string, string> = {
  "plan.deadline.first_passes": "YOVA teaches every topic before returning to practice",
  "plan.deadline.compressed_learning": "YOVA puts the learning blocks closer together",
  "plan.deadline.compressed_spacing": "YOVA brings practice returns closer together",
  "plan.deadline.shorter_blocks": "YOVA makes blocks shorter so more of your topics fit",
};
const ORDER = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "plan.deadline"];

export function personalizationSentence(ruleIds: readonly string[], context: PersonalizationSentenceContext) {
  const sentences: string[] = [];
  const rank = (ruleId: string) => ORDER.indexOf(ruleId.startsWith("plan.deadline.") ? "plan.deadline" : ruleId.split(".")[0]!);
  const sorted = [...new Set(ruleIds)].sort((a, b) => rank(a) - rank(b));
  const deadline = context.deadline ? new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: context.timeZone }).format(new Date(context.deadline)) : null;
  for (const ruleId of sorted) {
    const [layer, , option] = ruleId.split(".");
    if (layer === "P9" && option && SUPPORT[option] && onboardingSupportNeeds(context.answers).includes(option)) {
      const label = FUNCTIONAL_SUPPORT_OPTIONS.find(item => item.id === option)?.label;
      if (label) sentences.push(`Because you said ${quoted(label)} would help, ${SUPPORT[option]}.`);
      continue;
    }
    if (ruleId.startsWith("plan.deadline.") && DEADLINE[ruleId] && deadline) { sentences.push(`Because your deadline is ${deadline}, ${DEADLINE[ruleId]}.`); continue; }
    const rule = layer ? RULES[layer] : undefined;
    if (!rule || !option) continue;
    // The sentence quotes what the learner actually answered, never the rule's option.
    const answered = onboardingAnswerId(context.answers, rule.question);
    const label = onboardingOptionLabel(rule.question, answered);
    const did = answered === option ? rule.did(option, context) : null;
    if (label && did) sentences.push(`Because you said ${rule.said(label)}, ${did}.`);
  }
  return sentences.join(" ").slice(0, 1600);
}
