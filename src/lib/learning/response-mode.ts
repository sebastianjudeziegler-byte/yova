import type { LearningTaskType } from "@/lib/learning/method-catalog";

export type FreeResponseMode = "explanation" | "quantitative_workpad";

type FreeResponseModeInput = {
  taskType?: LearningTaskType | null;
  title: string;
  prompt: string;
  referenceAnswer: string;
};

const CONCEPTUAL_PROMPT = /\b(?:explain|describe|why|meaning|in your own words|how does|how do|what makes)\b/i;
const QUANTITATIVE_ACTION = /\b(?:calculate|compute|differentiat(?:e|ion)|evaluate|find (?:the )?(?:derivative|integral|value|slope|rate)|integrat(?:e|ion)|simplify|solve|show (?:all |your )?(?:steps|work)|write (?:the )?(?:equation|formula)|apply (?:the )?(?:formula|rule))\b/i;
const QUANTITATIVE_NOTATION = /(?:\$[^$]+\$|\\frac|\\int|\\sqrt|\\sin|\\cos|\\tan|\^\{?\d|\b\w\s*=\s*[-+]?\d|[∫√±×÷])/;

export function selectFreeResponseMode({
  taskType,
  title,
  prompt,
  referenceAnswer,
}: FreeResponseModeInput): FreeResponseMode {
  if (taskType && taskType !== "problem_solving") return "explanation";

  const learnerPrompt = `${title} ${prompt}`;
  if (CONCEPTUAL_PROMPT.test(learnerPrompt) && !QUANTITATIVE_ACTION.test(learnerPrompt)) {
    return "explanation";
  }

  const fullActivity = `${learnerPrompt} ${referenceAnswer}`;
  return QUANTITATIVE_ACTION.test(learnerPrompt) || QUANTITATIVE_NOTATION.test(fullActivity)
    ? "quantitative_workpad"
    : "explanation";
}
