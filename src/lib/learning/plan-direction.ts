import type { AdjustableSessionRow } from "@/lib/learning/content-based-plan-adjustment";

export type PlanDirectionKind = "conceptual" | "teach_first" | "examples" | "practice" | "custom";

export type PlanDirection = {
  request: string;
  kind: PlanDirectionKind;
  learnerFacingLabel: string;
};

const CALCULATION_LANGUAGE = /\b(?:calculat(?:e|ion|ions|ing)|compute|formula|equation|percentage|percentages|arithmetic|solve for|quantitative|number crunching)\b/gi;
const CALCULATION_LANGUAGE_CHECK = /\b(?:calculat(?:e|ion|ions|ing)|compute|formula|equation|percentage|percentages|arithmetic|solve for|quantitative|number crunching)\b/i;

export function interpretPlanDirection(request: string): PlanDirection {
  const normalized = request.trim().replace(/\s+/g, " ");
  const conceptual = /\b(?:no|without|avoid|skip|remove|stop|less)\b.{0,32}\b(?:math|maths|calculation|calculations|formula|formulas|numbers|quantitative)\b/i.test(normalized)
    || /\b(?:conceptual|concepts only|focus on the ideas|focus on understanding)\b/i.test(normalized);
  if (conceptual) {
    return {
      request: normalized,
      kind: "conceptual",
      learnerFacingLabel: "Conceptual understanding without calculation tasks",
    };
  }
  if (/\b(?:teach|explain|start from scratch|beginner|foundation|basics|slow down|know nothing)\b/i.test(normalized)) {
    return {
      request: normalized,
      kind: "teach_first",
      learnerFacingLabel: "Teaching and foundations before independent practice",
    };
  }
  if (/\b(?:more examples|real examples|case studies|worked examples|show me examples)\b/i.test(normalized)) {
    return {
      request: normalized,
      kind: "examples",
      learnerFacingLabel: "More concrete examples before independent work",
    };
  }
  if (/\b(?:more practice|harder|challenge|less explanation|quiz me|test me)\b/i.test(normalized)) {
    return {
      request: normalized,
      kind: "practice",
      learnerFacingLabel: "More independent practice and challenge",
    };
  }
  return {
    request: normalized,
    kind: "custom",
    learnerFacingLabel: normalized,
  };
}

export function applyPlanDirectionFallback(
  rows: AdjustableSessionRow[],
  request: string,
  topic: string,
): AdjustableSessionRow[] {
  const direction = interpretPlanDirection(request);
  return rows.map((row, index) => {
    const stepData = readStepData(row.step_data);
    const existingTargets = readStrings(stepData.contentTargets);
    const topicLabel = topic.trim() || existingTargets[0] || row.title;

    if (direction.kind === "conceptual") {
      const targets = (existingTargets.length ? existingTargets : [topicLabel])
        .map((target) => conceptualTarget(target))
        .filter((target, targetIndex, values) => values.indexOf(target) === targetIndex)
        .slice(0, 6);
      return {
        ...row,
        title: conceptualTitle(row.title, topicLabel, index),
        objective: `Build a conceptual understanding of ${topicLabel} through clear explanations, examples, comparisons, and decisions.`,
        method: index === 0 ? "Guided explanation and case analysis" : "Conceptual retrieval and scenario analysis",
        method_rationale: `The learner asked to keep the remaining plan conceptual. YOVA will explain relationships and tradeoffs, then check understanding with words and scenarios instead of calculations.`,
        step_data: {
          ...stepData,
          learningMode: index === 0 ? "learn" : readLearningMode(stepData.learningMode),
          contentTargets: targets,
          completionEvidence: [
            `Explain the central relationship in ${targets[0] ?? topicLabel} in plain language`,
            "Apply the idea to one qualitative example or decision scenario",
          ],
          learnerDirection: direction.request,
          learnerDirectionLabel: direction.learnerFacingLabel,
        },
      };
    }

    if (direction.kind === "teach_first" || direction.kind === "examples") {
      const examplesFirst = direction.kind === "examples";
      return {
        ...row,
        title: index === 0
          ? examplesFirst ? `Learn through a concrete example` : `Build the foundation first`
          : row.title,
        objective: `${row.objective} ${examplesFirst ? "Begin with a concrete example and connect every step back to the main idea." : "Teach the necessary foundation before asking for unsupported recall or application."}`,
        method: examplesFirst ? "Worked example and self-explanation" : "Guided explanation and scaffolded practice",
        method_rationale: `${direction.learnerFacingLabel}. Support will fade only after the learner has seen an accurate model.`,
        step_data: {
          ...stepData,
          learningMode: index === 0 ? "learn" : readLearningMode(stepData.learningMode),
          learnerDirection: direction.request,
          learnerDirectionLabel: direction.learnerFacingLabel,
        },
      };
    }

    if (direction.kind === "practice") {
      return {
        ...row,
        objective: `${row.objective} Emphasize independent application and repair only the gaps the attempt reveals.`,
        method: "Independent practice and targeted repair",
        method_rationale: `${direction.learnerFacingLabel}. YOVA will reduce introductory support and use performance to decide what needs repair.`,
        step_data: {
          ...stepData,
          learningMode: "study",
          learnerDirection: direction.request,
          learnerDirectionLabel: direction.learnerFacingLabel,
        },
      };
    }

    return {
      ...row,
      objective: `${row.objective} Follow this learner-approved direction for the remaining work: ${direction.request}`,
      method_rationale: `${row.method_rationale} The learner also asked YOVA to follow this direction: ${direction.request}`,
      step_data: {
        ...stepData,
        learnerDirection: direction.request,
        learnerDirectionLabel: direction.learnerFacingLabel,
      },
    };
  });
}

export function planDirectionConflictsWithRequest(rows: AdjustableSessionRow[], request: string) {
  if (interpretPlanDirection(request).kind !== "conceptual") return false;
  const generatedText = rows.map((row) => [
    row.title,
    row.objective,
    row.method,
    ...readStrings(readStepData(row.step_data).contentTargets),
    ...readStrings(readStepData(row.step_data).completionEvidence),
  ].join(" ")).join(" ");
  return CALCULATION_LANGUAGE_CHECK.test(generatedText);
}

function conceptualTarget(target: string) {
  const cleaned = target
    .replace(CALCULATION_LANGUAGE, "conceptual meaning")
    .replace(/\b(?:simple|basic)\s+(ownership|valuation)\s+conceptual meaning\b/gi, "$1 meaning")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Conceptual meaning and real-world tradeoffs";
}

function conceptualTitle(title: string, topic: string, index: number) {
  const cleaned = title.replace(CALCULATION_LANGUAGE, "understand").replace(/\s+/g, " ").trim();
  if (cleaned !== title && cleaned.length >= 3) return cleaned;
  if (index === 0) return `Understand the big picture of ${topic}`.slice(0, 160);
  return cleaned;
}

function readStepData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function readLearningMode(value: unknown) {
  return value === "learn" ? "learn" : "study";
}
