import type { MethodPhase } from "@/lib/learning/method-fidelity";

export type MethodPhasePresentation = {
  label: string;
  instruction: string;
  supportLabel: string;
};

export type MethodPhaseRoadmapItem = MethodPhasePresentation & {
  phase: MethodPhase;
  sequence: number;
};

const PRESENTATION: Record<MethodPhase, MethodPhasePresentation> = {
  orient: {
    label: "Orient to the target",
    instruction: "Identify what this session must accomplish before beginning the learning work.",
    supportLabel: "Target visible",
  },
  model: {
    label: "See a complete model",
    instruction: "Study the explanation or worked example and notice why each important part is there.",
    supportLabel: "Full support",
  },
  read_source: {
    label: "Read with a question",
    instruction: "Use the guiding question to read one bounded source section with a specific purpose.",
    supportLabel: "Source visible",
  },
  retrieve: {
    label: "Attempt from memory",
    instruction: "Produce the answer before looking. The attempt creates the evidence YOVA needs.",
    supportLabel: "Answer hidden",
  },
  explain: {
    label: "Explain why it works",
    instruction: "Rebuild the relationship or reason in your own words, then compare it with the model.",
    supportLabel: "Generate first",
  },
  guided_practice: {
    label: "Practice with less help",
    instruction: "Complete the missing reasoning or steps while some structure remains visible.",
    supportLabel: "Support reduced",
  },
  independent_practice: {
    label: "Perform independently",
    instruction: "Complete a comparable task without the solution or procedure remaining visible.",
    supportLabel: "Support hidden",
  },
  discriminate: {
    label: "Choose the approach",
    instruction: "Identify which category or method applies before solving the mixed item.",
    supportLabel: "Method not named",
  },
  repair: {
    label: "Compare and repair",
    instruction: "Use feedback after the attempt to correct the exact missing or mistaken part.",
    supportLabel: "Feedback available",
  },
  evidence_match: {
    label: "Match evidence to the claim",
    instruction: "Return to the source and attach accurate support to the structure you generated first.",
    supportLabel: "Source reopened",
  },
  code_trace: {
    label: "Trace the working code",
    instruction: "Predict what each important line does before using the example as a model.",
    supportLabel: "Working example visible",
  },
  transfer: {
    label: "Apply it in a new context",
    instruction: "Use the corrected idea or procedure on a different prompt, example, or problem.",
    supportLabel: "New application",
  },
  schedule_return: {
    label: "Schedule the return",
    instruction: "Name when this idea will be retrieved again after enough time has passed.",
    supportLabel: "Delayed check",
  },
  reflect: {
    label: "Name the next need",
    instruction: "Identify what held up and what still needs evidence in a later attempt.",
    supportLabel: "Evidence recorded",
  },
};

export function getMethodPhasePresentation(phase: MethodPhase) {
  return PRESENTATION[phase];
}

export function buildMethodPhaseRoadmap(
  phases: Array<MethodPhase | undefined>,
): MethodPhaseRoadmapItem[] {
  const collapsed = phases.reduce<MethodPhase[]>((result, phase) => {
    if (!phase || result.at(-1) === phase) return result;
    result.push(phase);
    return result;
  }, []);

  return collapsed.map((phase, index) => ({
    phase,
    sequence: index + 1,
    ...PRESENTATION[phase],
  }));
}

export function methodPhasePosition(
  phases: Array<MethodPhase | undefined>,
  stepIndex: number,
) {
  const roadmap = buildMethodPhaseRoadmap(phases);
  const currentRoadmap = buildMethodPhaseRoadmap(phases.slice(0, stepIndex + 1));
  if (!roadmap.length || !currentRoadmap.length) return null;
  return {
    current: currentRoadmap.length,
    total: roadmap.length,
  };
}
