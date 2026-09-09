import { answerEvaluationCases, type AnswerEvaluationCase } from "./answer-evaluation-cases";

const base = answerEvaluationCases[0]!.request;
const fixture = (id: string, subject: string, prompt: string, referenceAnswer: string, rubric: string, learnerAnswer: string, expectedVerdicts: AnswerEvaluationCase["expectedVerdicts"]): AnswerEvaluationCase => ({
  id, label: `${subject}: ${id}`, expectedVerdicts,
  humanRationale: expectedVerdicts.includes("secure") ? "The required idea is complete; optional detail must not be called missing." : "The response or supplied context is insufficient to establish the required causal relationship.",
  request: { ...base, learnerAnswer, activity: { title: `Explain the ${subject} relationship`, concept: subject, prompt, referenceAnswer, rubric } },
});

export const completeAnswerFixtures = [
  answerEvaluationCases.find(item => item.id === "biology-paraphrase")!,
  answerEvaluationCases.find(item => item.id === "programming-concise")!,
  fixture("complete-history", "history", "Why did many American colonists resist parliamentary taxation?", "They disputed Parliament's authority to tax them without colonial representation. The Stamp Act of 1765 was one example.", "Require the representation or political-authority dispute. Naming a particular act or date is optional, not required.", "They objected to a Parliament in which they had no representatives claiming the right to tax them.", ["secure"]),
];

export const underspecifiedAnswerFixtures = [
  fixture("underspecified-biology", "biology", "How does removing oxygen affect the electron transport chain?", "Without the final electron acceptor, electron flow stops and oxidative phosphorylation cannot continue.", "Require oxygen's role as final electron acceptor and its consequence for electron flow. A vague mention of a change does not establish either.", "It changes because the conditions change and then things stop working normally.", ["needs_review", "uncertain"]),
  fixture("underspecified-programming", "programming", "Why is a base case necessary in a recursive function?", "The base case stops further recursive calls when its condition is met, preventing unbounded recursion.", "Require a stopping condition and termination of recursive calls. Saying that it makes code work is insufficient.", "It makes the function work properly by doing the necessary thing at the right time.", ["needs_review", "uncertain"]),
  fixture("underspecified-history", "history", "Why did colonists resist parliamentary taxation without colonial representation?", "They challenged Parliament's authority to tax them without representation.", "Require the issue of representation or political authority, not merely unhappiness or change.", "They were unhappy because conditions changed and they did not like what was happening.", ["needs_review", "uncertain"]),
];

export const insufficientContextFixtures = [
  fixture("missing-context-biology", "biology", "Why did the observed respiration rate change in the second sample?", "The respiration rate changed because a relevant experimental condition changed.", "Identify the specific changed condition and connect it to respiration. No observations or experimental conditions are supplied.", "The surroundings probably changed and that affected respiration.", ["uncertain"]),
  fixture("missing-context-programming", "programming", "Why does this function return the wrong value on the second call?", "Its state changed between calls.", "Identify the state change from the code and inputs. The activity provides neither the function nor its inputs or outputs.", "Something stored probably changed between the calls.", ["uncertain"]),
  fixture("missing-context-history", "history", "Why did the government's policy change after the crisis?", "Political conditions changed during the crisis.", "Identify the government, crisis, and causal political change. None of those details or a source excerpt is provided.", "The political situation changed, so the policy changed too.", ["uncertain"]),
];
