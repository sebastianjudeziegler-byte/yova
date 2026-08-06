import type { AnswerEvaluationRequest } from "@/lib/session-evaluation/schema";

export type AnswerEvaluationCase = {
  id: string;
  label: string;
  expectedVerdicts: Array<"secure" | "needs_review" | "uncertain">;
  humanRationale: string;
  request: AnswerEvaluationRequest;
};

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

function request(
  learnerAnswer: string,
  activity: AnswerEvaluationRequest["activity"],
): AnswerEvaluationRequest {
  return {
    planId: PLAN_ID,
    planSessionId: SESSION_ID,
    learnerAnswer,
    activity,
  };
}

/**
 * A small human-labeled benchmark for the decisions YOVA makes during a session.
 *
 * These cases intentionally vary subject, response length, and wording. They are
 * not product examples or model prompts; they are regression checks that help us
 * notice when a model or prompt change makes formative feedback less trustworthy.
 */
export const answerEvaluationCases: AnswerEvaluationCase[] = [
  {
    id: "biology-paraphrase",
    label: "accepts a correct biology paraphrase",
    expectedVerdicts: ["secure"],
    humanRationale:
      "The answer states oxygen's essential role and the consequence even though it does not copy the reference wording.",
    request: request(
      "Oxygen takes the electrons at the end of the chain. Without that final place for them to go, the chain backs up and ATP production through oxidative phosphorylation stops.",
      {
        title: "Explain oxygen's role",
        prompt: "Why is oxygen necessary for the electron transport chain in cellular respiration?",
        concept: "Electron transport chain",
        referenceAnswer:
          "Oxygen is the final electron acceptor. It accepts electrons and hydrogen ions to form water, allowing electron flow and oxidative phosphorylation to continue.",
        rubric:
          "A secure answer identifies oxygen as the final electron acceptor and explains that accepting electrons allows the chain or ATP-producing process to continue. Forming water is useful but not required.",
      },
    ),
  },
  {
    id: "biology-misconception",
    label: "catches confident biology keyword soup",
    expectedVerdicts: ["needs_review"],
    humanRationale:
      "The response uses relevant vocabulary but reverses causality and incorrectly describes organisms as choosing mutations.",
    request: request(
      "Natural selection happens because organisms need to survive, so they choose helpful mutations and pass those changes on until the whole species adapts.",
      {
        title: "Explain natural selection",
        prompt: "How does natural selection change a population across generations?",
        concept: "Natural selection",
        referenceAnswer:
          "Individuals vary in heritable traits. Those with traits that improve reproductive success tend to leave more offspring, so those traits become more common across generations.",
        rubric:
          "A secure answer must connect pre-existing heritable variation, differential reproduction, and a population-level change over generations. It must not imply that organisms intentionally choose needed mutations.",
      },
    ),
  },
  {
    id: "history-partial-cause",
    label: "marks a materially incomplete causal explanation for review",
    expectedVerdicts: ["needs_review"],
    humanRationale:
      "Taxation is relevant, but the answer misses representation and the broader dispute about political authority required by the rubric.",
    request: request(
      "The colonists were angry because Britain made them pay more taxes.",
      {
        title: "Explain colonial resistance",
        prompt: "Why did many American colonists resist British taxation after the Seven Years' War?",
        concept: "Taxation without representation",
        referenceAnswer:
          "Many colonists opposed new taxes because Parliament imposed them without colonial representation, raising a broader dispute over whether Parliament had authority to tax the colonies directly.",
        rubric:
          "A secure answer must go beyond disliking taxes and explain the representation or political-authority issue. Naming a specific act is optional.",
      },
    ),
  },
  {
    id: "calculus-equivalent-notation",
    label: "accepts equivalent mathematical notation",
    expectedVerdicts: ["secure"],
    humanRationale:
      "The derivative is correct and the brief rule explanation establishes how it was obtained.",
    request: request(
      "f'(x) = 3x² + 2. I used the power rule on x³, and 2x differentiates to 2.",
      {
        title: "Differentiate a polynomial",
        prompt: "Differentiate f(x) = x^3 + 2x and briefly explain your step.",
        concept: "Power rule",
        referenceAnswer:
          "The derivative is 3x^2 + 2. By the power rule, the derivative of x^3 is 3x^2, and the derivative of 2x is 2.",
        rubric:
          "A secure answer gives an expression equivalent to 3x^2 + 2 and correctly identifies or demonstrates the power rule. Unicode superscripts and caret notation are equivalent.",
      },
    ),
  },
  {
    id: "finance-causal-partial",
    label: "does not reward a true statement that misses the mechanism",
    expectedVerdicts: ["needs_review"],
    humanRationale:
      "Diversification can reduce risk, but merely saying there are more investments does not explain reduced exposure to any one asset or uncorrelated losses.",
    request: request(
      "It lowers risk because you own more investments instead of fewer.",
      {
        title: "Explain diversification",
        prompt: "Why can diversification reduce portfolio-specific risk?",
        concept: "Diversification",
        referenceAnswer:
          "Diversification spreads exposure across assets whose outcomes do not move perfectly together, so poor performance by one holding has less effect on the whole portfolio.",
        rubric:
          "A secure answer must explain that spreading exposure reduces dependence on any single holding or that imperfectly correlated outcomes can offset one another. Simply saying 'more investments' is incomplete.",
      },
    ),
  },
  {
    id: "programming-concise",
    label: "accepts a concise programming explanation",
    expectedVerdicts: ["secure"],
    humanRationale:
      "The response correctly states that the base case terminates recursive calls and prevents unbounded recursion.",
    request: request(
      "It gives the function a stopping condition. Otherwise it keeps calling itself until the program runs out of stack space.",
      {
        title: "Explain a recursive base case",
        prompt: "What role does a base case play in a recursive function?",
        concept: "Recursion",
        referenceAnswer:
          "The base case stops the recursion when a terminating condition is reached, preventing infinite recursive calls and allowing earlier calls to return.",
        rubric:
          "A secure answer explains that the base case terminates recursive calls. Mentioning return unwinding is useful but not required.",
      },
    ),
  },
  {
    id: "ambiguous-prompt",
    label: "admits uncertainty when the prompt lacks necessary context",
    expectedVerdicts: ["uncertain"],
    humanRationale:
      "Neither the prompt nor the reference identifies what process changed, so several interpretations are defensible.",
    request: request(
      "It probably changed because the conditions around it changed.",
      {
        title: "Interpret an unexplained change",
        prompt: "Why did the rate change between the first and second observation?",
        concept: "Rate of change",
        referenceAnswer: "The rate changed because the relevant condition changed.",
        rubric:
          "Judge whether the learner identifies the specific changed condition and connects it causally to the rate. The activity does not provide the observations or name the condition.",
      },
    ),
  },
];
