import type { LearningPlan } from "@/lib/domain";
import {
  buildPlanContentBudget,
  type PlanContentBudget,
} from "@/lib/plan-generation/content-budget";
import { materializePlanDraft } from "@/lib/plan-generation/materialize-plan";
import {
  GeneratedPlanDraftSchema,
  type GeneratedPlanDraft,
  type PlanGenerationRequest,
} from "@/lib/plan-generation/schema";
import {
  inferPlanScopeContract,
  type PlanScopeContract,
} from "@/lib/plan-generation/scope-contract";
import { deriveLearningTitle } from "@/lib/intake/interpret";
import {
  buildPlanPreferenceContract,
  type PlanPreferenceContract,
} from "@/lib/personalization/plan-preference-contract";

type PreviewBlueprint = {
  phaseIndex: number;
  minutes: number;
  title: string;
  objective: string;
  topicIds?: string[];
  contentTargets: string[];
  completionEvidence: string[];
  learningMode?: "learn" | "study";
};

type PreviewSubject = {
  title: string;
  topic: string;
  kind: GeneratedPlanDraft["kind"];
  sessionTitles: [string, string, string, string, string];
  focusedTargets?: string[];
};

const SUBJECTS: Array<{ matches: RegExp; subject: PreviewSubject }> = [
  {
    matches: /world war (?:i|1)|wwi|first world war/i,
    subject: {
      title: "World War I Study Plan",
      topic: "World War I causes, escalation, major turning points, and consequences",
      kind: "test",
      sessionTitles: [
        "Build the causes and escalation map",
        "Connect the alliances and major fronts",
        "Explain the turning points",
        "Practice historical cause and effect",
        "Complete a final retrieval review",
      ],
      focusedTargets: [
        "Long-term causes and the July Crisis",
        "How alliances and mobilization widened the war",
        "Major turning points and consequences",
      ],
    },
  },
  {
    matches: /startup.*fund|funding.*startup|term sheets?|dilution.*investor/i,
    subject: {
      title: "Startup Funding Foundations",
      topic: "Startup funding stages, investors, instruments, dilution, and term sheets",
      kind: "topic",
      sessionTitles: [
        "Build the startup funding map",
        "Compare funding instruments",
        "Reason about dilution",
        "Read a simple term sheet",
        "Connect the full funding decision",
      ],
      focusedTargets: [
        "How funding stages and investor types connect",
        "How common funding instruments change ownership or repayment",
        "How dilution and term-sheet terms affect founders and investors",
      ],
    },
  },
  {
    matches: /product rule/i,
    subject: {
      title: "Calculus: Product Rule",
      topic: "The product rule for derivatives",
      kind: "skill",
      sessionTitles: [
        "Recall the product-rule structure",
        "Study a worked product-rule example",
        "Solve with fading support",
        "Complete mixed product-rule practice",
        "Repair the last mistakes",
      ],
    },
  },
  {
    matches: /biology|photosynthesis|cellular respiration/i,
    subject: {
      title: "AP Biology Unit 3",
      topic: "Photosynthesis and cellular respiration",
      kind: "test",
      sessionTitles: [
        "Retrieve cellular respiration",
        "Build the comparison",
        "Apply and distinguish",
        "Practice test and repair",
        "Rapid recall",
      ],
    },
  },
  {
    matches: /calculus|derivative|product rule|quotient rule/i,
    subject: {
      title: "Calculus: Derivatives",
      topic: "Derivative rules and applied problem solving",
      kind: "test",
      sessionTitles: [
        "Recall the core rules",
        "Study worked examples",
        "Solve with fading support",
        "Complete mixed practice",
        "Repair the last mistakes",
      ],
    },
  },
  {
    matches: /finance|investing|budget|credit|interest/i,
    subject: {
      title: "Personal Finance Fundamentals",
      topic: "Budgeting, credit, interest, and investing basics",
      kind: "topic",
      sessionTitles: [
        "Map the fundamentals",
        "Work through real examples",
        "Retrieve the key decisions",
        "Apply concepts to scenarios",
        "Consolidate the framework",
      ],
    },
  },
];

const DEFAULT_SUBJECT: PreviewSubject = {
  title: "New learning goal",
  topic: "The goal and concepts described by the learner",
  kind: "topic",
  sessionTitles: [
    "Build the mental model",
    "Retrieve the essentials",
    "Practice with guidance",
    "Apply independently",
    "Review and consolidate",
  ],
};

const METHODS = [
  "Closed-note retrieval",
  "Guided concept repair",
  "Mixed practice",
  "Assessment and error review",
  "Spaced final review",
] as const;

const LEARNING_METHODS = [
  "Guided explanation and self-explanation",
  "Worked example fading",
  "Guided retrieval and distinction practice",
  "Independent application and error repair",
  "Spaced retrieval",
] as const;

export function generatePreviewPlan(request: PlanGenerationRequest): LearningPlan {
  const derivedTitle = deriveLearningTitle(request.goal);
  const subject = SUBJECTS.find(({ matches }) => matches.test(request.goal))?.subject ?? {
    ...DEFAULT_SUBJECT,
    title: derivedTitle,
    topic: derivePreviewTopic(request.goal, derivedTitle),
  };
  const deadline = request.deadline ? new Date(request.deadline) : inferDeadline(request.goal);
  const scope = inferPlanScopeContract(request);
  const contentBudget = buildPlanContentBudget(request, scope);
  const preferenceContract = buildPlanPreferenceContract(request.profileSummary);
  const targetMinutes = contentBudget.typicalSession.minutes;
  const sessionBlueprints: PreviewBlueprint[] = request.knowledgeMap
    ? buildKnowledgeMappedBlueprints(request, scope, contentBudget, targetMinutes)
    : request.intent === "study_now"
      ? [previewBlueprint(subject, request, 0, 0, 1, targetMinutes)]
      : buildScopedBlueprints(subject, request, scope, contentBudget, targetMinutes);
  const scheduledTopicIds = new Set(sessionBlueprints.flatMap((blueprint) => blueprint.topicIds ?? []));
  const deferredTopics = request.knowledgeMap?.topics
    .filter((topic) => !scheduledTopicIds.has(topic.id))
    .map((topic) => ({
      topicId: topic.id,
      reason: "This topic falls outside the sessions that fit the current time budget. Extend the plan to include it.",
    })) ?? [];
  const draft = GeneratedPlanDraftSchema.parse({
    title: request.knowledgeMap ? derivedTitle : subject.title,
    topic: request.knowledgeMap ? derivePreviewTopic(request.goal, derivedTitle) : subject.topic,
    kind: scope.band === "broad_course" ? "course" : subject.kind,
    deadline: request.intent === "study_now" ? null : deadline?.toISOString() ?? null,
    rationale: `${buildRationale(request, preferenceContract)} ${scope.explanation}`,
    deferredTopics,
    sessions: sessionBlueprints.map((blueprint, index) => {
      const availability = request.availability[index % request.availability.length];
      const minutes = Math.min(availability.minutes, blueprint.minutes);

      return {
        title: blueprint.title,
        objective: blueprint.objective,
        method: request.studyMode === "outside"
          ? outsideMethodFor(request.goal)
          : request.intent === "study_now" && request.learningIntent === "learn"
            ? "Self-explanation with worked example fading"
            : request.learningIntent === "learn"
              ? LEARNING_METHODS[blueprint.phaseIndex]
              : METHODS[blueprint.phaseIndex],
        methodReason: `${request.studyMode === "outside"
          ? outsideMethodReason(request.goal)
          : request.intent === "study_now" && request.learningIntent === "learn"
            ? "The learner has not built this foundation yet, so YOVA should explain the overall model, walk through one concrete example, and then reduce support for a short understanding check."
            : request.learningIntent === "learn"
              ? learningReasonFor(blueprint.phaseIndex)
              : reasonFor(blueprint.phaseIndex, request)} ${preferenceReasonFor(blueprint.learningMode ?? sessionLearningMode(request, blueprint.phaseIndex), blueprint.phaseIndex, preferenceContract)}`,
        scheduledFor: scheduledDate(index, sessionBlueprints.length, availability.window, deadline).toISOString(),
        estimatedMinutes: minutes,
        amountLabel: `${blueprint.contentTargets.length} focused ${blueprint.contentTargets.length === 1 ? "target" : "targets"} + evidence check · about ${minutes} min`,
        learningMode: blueprint.learningMode ?? sessionLearningMode(request, blueprint.phaseIndex),
        topicIds: blueprint.topicIds ?? topicIdsForPreviewSession(request, index, sessionBlueprints.length),
        contentTargets: blueprint.contentTargets,
        completionEvidence: blueprint.completionEvidence,
      };
    }),
  });

  return materializePlanDraft(draft, request);
}

function buildKnowledgeMappedBlueprints(
  request: PlanGenerationRequest,
  scope: PlanScopeContract,
  contentBudget: PlanContentBudget,
  minutes: number,
): PreviewBlueprint[] {
  const topics = request.knowledgeMap?.topics ?? [];
  if (!topics.length) return [];
  const sessionCount = request.intent === "study_now"
    ? 1
    : Math.min(scope.maximumSessions, Math.max(scope.minimumSessions, contentBudget.recommendedSessions));
  const maximumTargets = contentBudget.typicalSession.maximumContentTargets;
  const demonstrated = topics.filter((topic) => topic.initialEvidence?.outcome === "demonstrated");
  const gapsAndUnknown = topics.filter((topic) => topic.initialEvidence?.outcome !== "demonstrated");
  const reservedPlacementVerification = demonstrated.length > 0 ? 1 : 0;
  const reservedReviewSessions = request.intent === "plan" && request.learningIntent === "learn" && sessionCount > 1 ? 1 : 0;
  const coverageSlots = Math.max(1, sessionCount - reservedReviewSessions);
  const scheduledTopics = [...gapsAndUnknown, ...demonstrated].slice(0, coverageSlots * maximumTargets);
  const teachingTopics = scheduledTopics.filter((topic) => topic.initialEvidence?.outcome !== "demonstrated");
  const verificationTopics = scheduledTopics.filter((topic) => topic.initialEvidence?.outcome === "demonstrated");
  const coverageSessionCount = Math.min(
    Math.max(1, coverageSlots - reservedPlacementVerification),
    Math.max(1, Math.ceil(teachingTopics.length / contentBudget.typicalSession.preferredContentTargets)),
  );
  const topicGroups = distributeInOrder(teachingTopics, coverageSessionCount);
  const coverage = topicGroups.map<PreviewBlueprint>((group, index) => {
    const hasConfirmedGap = group.some((topic) => topic.initialEvidence?.outcome === "gap");
    const mode = hasConfirmedGap || request.learningIntent === "learn" ? "learn" as const : "study" as const;
    const label = topicGroupLabel(group.map((topic) => topic.title));
    return {
      phaseIndex: mode === "learn" ? Math.min(index, 2) : Math.min(index, 3),
      minutes: Math.max(10, Math.min(minutes, 60)),
      title: boundedTitle(mode === "learn" ? `Learn ${label}` : `Retrieve and apply ${label}`),
      objective: boundedObjective(request.studyMode === "outside"
        ? `Use your chosen source to make progress toward ${shortTopic(request.goal)} by learning ${group.map((topic) => topic.title).join(", ")}, close the source, then return to YOVA with an explanation or application.`
        : mode === "learn"
          ? `Build an accurate first mental model of ${group.map((topic) => topic.title).join(", ")}, connect it to its prerequisites, then explain or apply it with less support.`
          : `Retrieve and apply ${group.map((topic) => topic.title).join(", ")} without notes, then repair only the gap the attempt reveals.`),
      topicIds: group.map((topic) => topic.id),
      contentTargets: group.map((topic) => topic.title),
      completionEvidence: mode === "learn"
        ? ["Explain or apply each mapped topic after the model is hidden"]
        : ["Attempt each target without notes and correct any exposed gap"],
      learningMode: mode,
    };
  });
  const placementVerification = verificationTopics.length > 0 ? [{
    phaseIndex: 3,
    minutes: Math.max(5, Math.min(minutes, 15)),
    title: boundedTitle(`Quickly verify ${topicGroupLabel(verificationTopics.map((topic) => topic.title))}`),
    objective: boundedObjective(`Confirm ${verificationTopics.map((topic) => topic.title).join(", ")} with a short closed-source check before treating the placement result as durable evidence.`),
    topicIds: verificationTopics.slice(0, maximumTargets).map((topic) => topic.id),
    contentTargets: verificationTopics.slice(0, maximumTargets).map((topic) => topic.title),
    completionEvidence: ["Answer one short verification question for each demonstrated topic without notes"],
    learningMode: "study" as const,
  }] : [];
  const reviewCount = Math.max(0, sessionCount - coverage.length - placementVerification.length);
  const reviewGroups = distributeInOrder(scheduledTopics, Math.max(1, reviewCount));
  const reviews = Array.from({ length: reviewCount }, (_, index): PreviewBlueprint => {
    const group = (reviewGroups[index] ?? reviewGroups.at(-1) ?? scheduledTopics.slice(0, 1))
      .slice(0, maximumTargets);
    const finalReview = index === reviewCount - 1;
    return {
      phaseIndex: finalReview ? 4 : 3,
      minutes: Math.max(10, Math.min(minutes, 60)),
      title: boundedTitle(finalReview
        ? `Verify ${topicGroupLabel(group.map((topic) => topic.title))} after a delay`
        : `Connect and apply ${topicGroupLabel(group.map((topic) => topic.title))}`),
      objective: boundedObjective(finalReview
        ? `Retrieve ${group.map((topic) => topic.title).join(", ")} after time has passed and identify only what still needs another pass.`
        : `Use ${group.map((topic) => topic.title).join(", ")} together in a new situation and justify the relationship or method selected.`),
      topicIds: group.map((topic) => topic.id),
      contentTargets: group.map((topic) => topic.title),
      completionEvidence: finalReview
        ? ["Complete one delayed closed-source check for each mapped topic"]
        : ["Complete one mixed application and justify the selected relationship"],
      learningMode: "study",
    };
  });
  return [...coverage, ...placementVerification, ...reviews];
}

function boundedObjective(value: string) {
  if (value.length <= 280) return value;
  const shortened = value.slice(0, 277);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, Math.max(0, boundary))}...`;
}

function boundedTitle(value: string) {
  if (value.length <= 90) return value;
  const shortened = value.slice(0, 87);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, Math.max(0, boundary))}...`;
}

function distributeInOrder<T>(values: T[], groupCount: number): T[][] {
  if (!values.length || groupCount <= 0) return [];
  const groups: T[][] = [];
  let cursor = 0;
  for (let index = 0; index < Math.min(groupCount, values.length); index += 1) {
    const remainingValues = values.length - cursor;
    const remainingGroups = Math.min(groupCount, values.length) - index;
    const size = Math.ceil(remainingValues / remainingGroups);
    groups.push(values.slice(cursor, cursor + size));
    cursor += size;
  }
  return groups;
}

function topicGroupLabel(titles: string[]) {
  const [first = "the next topic"] = titles;
  const conciseFirst = shortTopic(first);
  if (titles.length === 1) return conciseFirst;
  return `${conciseFirst} and ${titles.length - 1} connected ${titles.length === 2 ? "topic" : "topics"}`;
}

function buildScopedBlueprints(
  subject: PreviewSubject,
  request: PlanGenerationRequest,
  scope: PlanScopeContract,
  contentBudget: PlanContentBudget,
  targetMinutes: number,
): PreviewBlueprint[] {
  if (request.materialMode === "upload" && contentBudget.mappedTopicTitles.length >= 2) {
    return materialScopedBlueprints(subject, request, scope, contentBudget, targetMinutes);
  }
  if (scope.band === "broad_course") {
    return /calculus/i.test(request.goal)
      ? broadCalculusBlueprints(targetMinutes)
      : broadCourseBlueprints(subject, contentBudget.recommendedSessions, targetMinutes);
  }

  if (scope.band === "focused_skill") {
    return focusedSkillBlueprints(subject, request, targetMinutes);
  }

  return subject.sessionTitles.flatMap((_, phaseIndex) => {
      const baseMinutes = [25, 30, 30, 35, 10][phaseIndex];
      const partCount = Math.max(1, Math.ceil(baseMinutes / targetMinutes));
      return Array.from({ length: partCount }, (_, partIndex) => (
        previewBlueprint(subject, request, phaseIndex, partIndex, partCount, Math.min(targetMinutes, baseMinutes))
      ));
    }).slice(0, scope.maximumSessions);
}

function materialScopedBlueprints(
  subject: PreviewSubject,
  request: PlanGenerationRequest,
  scope: PlanScopeContract,
  contentBudget: PlanContentBudget,
  minutes: number,
) {
  const reservedReviewSessions = request.learningIntent === "learn" ? 1 : 0;
  const maximumCoverageSessions = Math.max(
    1,
    Math.min(scope.maximumSessions, contentBudget.recommendedSessions) - reservedReviewSessions,
  );
  const targetCount = Math.min(
    contentBudget.typicalSession.maximumContentTargets,
    Math.max(
      contentBudget.typicalSession.preferredContentTargets,
      Math.ceil(contentBudget.mappedTopicTitles.length / maximumCoverageSessions),
    ),
  );
  const groups = chunk(contentBudget.mappedTopicTitles, targetCount);
  const teachingCount = Math.max(scope.minimumTeachingSessions, request.learningIntent === "learn" ? groups.length : 0);
  const coverage = groups.map<PreviewBlueprint>((targets, index) => {
    const learningMode = request.learningIntent === "learn" && index < teachingCount ? "learn" as const : "study" as const;
    const firstTarget = targets[0] ?? subject.topic;
    const topicLabel = targets.length === 1 ? firstTarget : `${firstTarget} and ${targets.length - 1} connected ${targets.length === 2 ? "idea" : "ideas"}`;
    return {
      phaseIndex: learningMode === "learn" ? Math.min(index, 2) : 3,
      minutes: Math.max(10, Math.min(minutes, 60)),
      title: learningMode === "learn" ? `Learn ${topicLabel}` : `Retrieve ${topicLabel}`,
      objective: learningMode === "learn"
        ? `Build a clear model of ${targets.join(", ")} from the uploaded scope, use one concrete example, and then explain the relationship with less support.`
        : `Retrieve and apply ${targets.join(", ")} without the source visible, then repair only the exact gap the attempt reveals.`,
      contentTargets: targets,
      completionEvidence: learningMode === "learn"
        ? ["Explain each listed target in your own words after the model is hidden"]
        : ["Attempt each listed target without notes and correct any exposed gap"],
      learningMode,
    };
  });
  const reviewCount = Math.max(0, contentBudget.recommendedSessions - coverage.length);
  const reviews = Array.from({ length: reviewCount }, (_, index): PreviewBlueprint => ({
    phaseIndex: index === reviewCount - 1 ? 4 : 3,
    minutes: Math.max(10, Math.min(minutes, 60)),
    title: index === reviewCount - 1 ? "Verify the uploaded scope after a delay" : `Connect the material across sections ${index + 1}`,
    objective: index === reviewCount - 1
      ? `Retrieve the highest-priority ideas from ${subject.topic} after a delay and identify only what still needs another pass.`
      : `Connect ideas from different parts of ${subject.topic}, choose which relationship applies, and explain the choice.`,
    contentTargets: index === reviewCount - 1
      ? [`Delayed retrieval across ${subject.topic}`]
      : [`Connections across the uploaded scope for ${subject.topic} ${index + 1}`],
    completionEvidence: index === reviewCount - 1
      ? ["Complete one cumulative closed-source check"]
      : ["Complete one mixed application and justify the selected relationship"],
    learningMode: "study",
  }));

  return [...coverage, ...reviews].slice(0, scope.maximumSessions);
}

function focusedSkillBlueprints(
  subject: PreviewSubject,
  request: PlanGenerationRequest,
  minutes: number,
): PreviewBlueprint[] {
  const topic = subject.topic;
  const specificProductRule = /product rule/i.test(request.goal);
  const phases = specificProductRule ? [
    {
      phaseIndex: 0,
      learningMode: "learn" as const,
      title: "Understand why the product rule works",
      objective: "Build the product rule from the idea that both factors change, then identify every part of the formula in one concrete example.",
      contentTargets: ["The product-rule structure and why both terms are necessary"],
      completionEvidence: ["Explain why differentiating each factor separately is incomplete"],
    },
    {
      phaseIndex: 1,
      learningMode: "learn" as const,
      title: "Follow one complete product-rule example",
      objective: "Work through one derivative step by step, then reconstruct the setup with less support.",
      contentTargets: ["Substituting each function and derivative into the product rule"],
      completionEvidence: ["Set up and simplify one similar derivative with reduced guidance"],
    },
    {
      phaseIndex: 2,
      learningMode: "study" as const,
      title: "Practice choosing and applying the rule",
      objective: "Distinguish product-rule problems from single-function derivatives and solve a short guided set.",
      contentTargets: ["Recognizing when the product rule applies", "Applying it without a displayed model"],
      completionEvidence: ["Choose the correct rule and solve two representative problems"],
    },
    {
      phaseIndex: 4,
      learningMode: "study" as const,
      title: "Verify the product rule independently",
      objective: "Complete a delayed mixed check and repair only the exact step that remains unstable.",
      contentTargets: ["Independent product-rule use in a new expression"],
      completionEvidence: ["Solve one transfer problem and explain the key setup decision"],
    },
  ] : [
    {
      phaseIndex: 0,
      learningMode: "learn" as const,
      title: `Build the model for ${shortTopic(topic)}`,
      objective: `Learn the central relationship in ${topic} and see one complete example before attempting it alone.`,
      contentTargets: [`The central structure of ${topic}`],
      completionEvidence: ["Explain the structure in plain language after the model is hidden"],
    },
    {
      phaseIndex: 1,
      learningMode: "learn" as const,
      title: "Work through a complete example",
      objective: "Follow one representative example, then reproduce the important decision with less support.",
      contentTargets: [`One complete worked example of ${topic}`],
      completionEvidence: ["Complete one similar example with reduced guidance"],
    },
    {
      phaseIndex: 2,
      learningMode: "study" as const,
      title: "Practice the skill with fading help",
      objective: "Use the skill in a short set where prompts gradually remove the original support.",
      contentTargets: [`Recognizing and applying ${topic}`],
      completionEvidence: ["Complete two representative attempts without reopening the model"],
    },
    {
      phaseIndex: 4,
      learningMode: "study" as const,
      title: "Verify the skill after a delay",
      objective: "Return to the skill without notes and repair only what is no longer available independently.",
      contentTargets: [`Independent retrieval and use of ${topic}`],
      completionEvidence: ["Complete one delayed transfer check without support"],
    },
  ];

  return phases.map((phase) => ({ ...phase, minutes: Math.max(10, Math.min(minutes, 30)) }));
}

function broadCalculusBlueprints(minutes: number): PreviewBlueprint[] {
  const phases: Array<Omit<PreviewBlueprint, "minutes">> = [
    { phaseIndex: 0, learningMode: "learn", title: "Build the function and graph foundation", objective: "Connect functions, notation, graphs, and average rate of change before calculus introduces instantaneous change.", contentTargets: ["Functions, graphs, and average rate of change"], completionEvidence: ["Interpret a function and explain an average rate from a graph"] },
    { phaseIndex: 0, learningMode: "learn", title: "Understand limits as approaching behavior", objective: "Build an intuitive model of a limit using tables, graphs, and nearby values before using limit rules.", contentTargets: ["Limits from graphs and nearby values"], completionEvidence: ["Estimate and explain one limit from multiple representations"] },
    { phaseIndex: 1, learningMode: "learn", title: "Connect limit rules and continuity", objective: "Use limit rules, identify continuity, and explain how discontinuities change what can be concluded.", contentTargets: ["Limit rules", "Continuity and discontinuity"], completionEvidence: ["Evaluate one limit and classify one continuity example"] },
    { phaseIndex: 0, learningMode: "learn", title: "Build the derivative from first principles", objective: "Connect secant slopes, tangent slopes, and the difference quotient to define an instantaneous rate of change.", contentTargets: ["The derivative as a limit of average rates"], completionEvidence: ["Explain the derivative definition and interpret it in context"] },
    { phaseIndex: 1, learningMode: "learn", title: "Learn the core derivative rules", objective: "Develop the power, constant, sum, and difference rules through worked examples with gradually reduced support.", contentTargets: ["Power and constant rules", "Sum and difference rules"], completionEvidence: ["Differentiate a short combination and explain each rule used"] },
    { phaseIndex: 1, learningMode: "learn", title: "Connect product, quotient, and chain rules", objective: "Learn how structure determines which derivative rule to use, then trace one example of each compound rule.", contentTargets: ["Product and quotient rules", "Chain rule"], completionEvidence: ["Choose and apply the correct compound rule in two examples"] },
    { phaseIndex: 2, learningMode: "learn", title: "Use implicit differentiation and related rates", objective: "Extend derivative rules to implicit relationships and changing quantities through guided problem setup.", contentTargets: ["Implicit differentiation", "Related-rates modeling"], completionEvidence: ["Set up one implicit or related-rates problem with reduced support"] },
    { phaseIndex: 2, learningMode: "study", title: "Apply derivatives to behavior and optimization", objective: "Use derivatives to analyze increasing behavior, extrema, concavity, and one optimization situation.", contentTargets: ["Curve analysis", "Optimization"], completionEvidence: ["Justify one graph conclusion and solve one bounded application"] },
    { phaseIndex: 0, learningMode: "learn", title: "Build the accumulation and integral model", objective: "Connect accumulated change, area, Riemann sums, and antiderivatives before learning integration procedures.", contentTargets: ["Accumulation and signed area", "Antiderivatives"], completionEvidence: ["Explain what a definite integral represents in one context"] },
    { phaseIndex: 1, learningMode: "learn", title: "Connect derivatives and integrals", objective: "Use the Fundamental Theorem of Calculus to connect accumulation functions, derivatives, and definite integrals.", contentTargets: ["The Fundamental Theorem of Calculus"], completionEvidence: ["Explain and apply both directions of the theorem in a simple example"] },
    { phaseIndex: 2, learningMode: "learn", title: "Learn core integration techniques and uses", objective: "Practice basic substitution and apply integrals to net change, area, and average value.", contentTargets: ["Basic substitution", "Applications of definite integrals"], completionEvidence: ["Choose and complete one integration method and one application"] },
    { phaseIndex: 4, learningMode: "study", title: "Complete a cumulative calculus transfer", objective: "Choose among limit, derivative, and integral ideas in mixed problems, then identify the next gap to revisit.", contentTargets: ["Method selection across calculus", "Independent transfer"], completionEvidence: ["Complete a mixed check and explain why each selected method fits"] },
  ];
  return phases.map((phase) => ({ ...phase, minutes: Math.max(10, Math.min(minutes, 35)) }));
}

function broadCourseBlueprints(subject: PreviewSubject, count: number, minutes: number): PreviewBlueprint[] {
  const topic = subject.topic;
  const phases: Array<Omit<PreviewBlueprint, "minutes">> = [
    { phaseIndex: 0, learningMode: "learn", title: "Map the subject and its prerequisites", objective: `See how the major parts of ${topic} connect and identify the foundation needed for later modules.`, contentTargets: [`The organizing map and prerequisites for ${topic}`], completionEvidence: ["Explain the major parts and their order in plain language"] },
    { phaseIndex: 0, learningMode: "learn", title: "Build the first foundational model", objective: `Learn the first major relationship in ${topic} through an explanation and one concrete example.`, contentTargets: [`The first foundational relationship in ${topic}`], completionEvidence: ["Reconstruct the first foundation without the model visible"] },
    { phaseIndex: 1, learningMode: "learn", title: "Build the second foundational model", objective: `Connect the next major idea in ${topic} to the foundation already established.`, contentTargets: [`The second foundational relationship in ${topic}`], completionEvidence: ["Complete one similar example with reduced guidance"] },
    { phaseIndex: 1, learningMode: "learn", title: "Connect the foundational ideas", objective: "Compare the first major concepts and explain when each one matters.", contentTargets: ["Connections and distinctions between the foundational ideas"], completionEvidence: ["Compare the foundations and correct one common confusion"] },
    { phaseIndex: 2, learningMode: "learn", title: "Learn the first application cluster", objective: "Use the foundational model in the first representative family of applications.", contentTargets: [`The first major application area in ${topic}`], completionEvidence: ["Complete one guided application and explain the choice made"] },
    { phaseIndex: 2, learningMode: "learn", title: "Learn the second application cluster", objective: "Extend the model to a second representative family of applications.", contentTargets: [`The second major application area in ${topic}`], completionEvidence: ["Complete one new application with reduced support"] },
    { phaseIndex: 2, learningMode: "study", title: "Distinguish the major approaches", objective: "Choose among the approaches learned so far and explain why the alternatives do not fit.", contentTargets: ["Method selection across the major concepts"], completionEvidence: ["Classify and complete a short mixed set"] },
    { phaseIndex: 3, learningMode: "study", title: "Apply the ideas independently", objective: "Use the subject model in new situations without the original teaching prompts visible.", contentTargets: [`Independent application across ${topic}`], completionEvidence: ["Complete two representative transfer attempts"] },
    { phaseIndex: 3, learningMode: "study", title: "Repair the highest-priority gaps", objective: "Use errors from independent work to revisit only the concepts that remain unstable.", contentTargets: ["The most important gaps exposed by independent work"], completionEvidence: ["Correct each exposed gap and retry it in a different prompt"] },
    { phaseIndex: 4, learningMode: "study", title: "Complete a cumulative review", objective: "Retrieve and apply the major ideas after a delay, then name what still needs another pass.", contentTargets: [`Cumulative retrieval across ${topic}`], completionEvidence: ["Complete a cumulative check without notes"] },
    { phaseIndex: 4, learningMode: "study", title: "Transfer the subject to a new context", objective: "Use the connected framework in one unfamiliar scenario that requires selecting the right ideas.", contentTargets: [`Transfer beyond the original examples in ${topic}`], completionEvidence: ["Complete one unfamiliar application and justify the approach"] },
    { phaseIndex: 4, learningMode: "study", title: "Consolidate the learning pathway", objective: "Summarize the durable framework, verify priority ideas, and identify the next meaningful learning goal.", contentTargets: [`The durable framework for ${topic}`], completionEvidence: ["Explain the full framework and complete a final priority check"] },
  ];
  return phases.slice(0, count).map((phase) => ({ ...phase, minutes: Math.max(10, Math.min(minutes, 35)) }));
}

function shortTopic(topic: string) {
  return topic.length > 52 ? `${topic.slice(0, 49).trim()}...` : topic;
}

function chunk<T>(values: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += Math.max(1, size)) {
    groups.push(values.slice(index, index + Math.max(1, size)));
  }
  return groups;
}

function derivePreviewTopic(goal: string, title: string) {
  const titlePattern = new RegExp(`^${escapeRegExp(title)}[.:]?\\s*`, "i");
  const cleaned = goal
    .replace(titlePattern, "")
    .replace(/\s+Scope:\s.*$/i, "")
    .replace(/\s+Starting point:\s.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const topic = cleaned || goal.trim() || title;
  return topic.length > 120 ? `${topic.slice(0, 117).trim()}...` : topic;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function previewBlueprint(subject: PreviewSubject, request: PlanGenerationRequest, phaseIndex: number, partIndex: number, partCount: number, minutes: number): PreviewBlueprint {
  if (request.studyMode === "outside") {
    const partLabel = partCount > 1 ? ` · Part ${partIndex + 1} of ${partCount}` : "";
    return {
      phaseIndex,
      minutes,
      title: `${request.intent === "study_now" ? "Work through your source" : subject.sessionTitles[phaseIndex]}${partLabel}`,
      objective: `Use your chosen source to make concrete progress on ${subject.topic}, then return to YOVA with evidence of what you produced or understood.`,
      contentTargets: [subject.topic],
      completionEvidence: [
        "Complete the assigned action using the outside source",
        "Return to YOVA and explain the result, decision, or remaining gap without copying the source",
      ],
    };
  }

  if (request.intent === "study_now") {
    const contentTargets = subject.focusedTargets ?? [subject.topic];
    const learningFirst = request.learningIntent === "learn";
    return {
      phaseIndex: 0,
      minutes,
      title: studyNowTitle(subject),
      objective: learningFirst
        ? `Build a clear first mental model of ${subject.topic}, work through one concrete example, and then explain the central relationships without the model visible.`
        : `Retrieve and apply the main ideas in ${subject.topic} without notes, then repair only the gaps the attempt reveals.`,
      contentTargets,
      completionEvidence: learningFirst
        ? [
            "Explain the central relationships in plain language after the model is hidden",
            "Complete one short application or distinction check with reduced support",
          ]
        : [
            "Attempt each target without notes before viewing feedback",
            "Correct the exposed gap and complete one new check without support",
          ],
    };
  }

  const title = request.learningIntent === "learn"
    ? learningTitleFor(subject.sessionTitles[phaseIndex], phaseIndex)
    : subject.sessionTitles[phaseIndex];
  const targets = contentTargetsFor(phaseIndex, subject.topic);
  const distributedTargets = targets.filter((_, index) => index % partCount === partIndex);
  const contentTargets = distributedTargets.length ? distributedTargets : [`The next bounded part of ${targets[Math.min(partIndex, targets.length - 1)]}`];
  const partLabel = partCount > 1 ? ` · Part ${partIndex + 1} of ${partCount}` : "";
  return {
    phaseIndex,
    minutes,
    title: `${title}${partLabel}`,
    objective: partCount > 1
      ? `${request.learningIntent === "learn" ? learningObjectiveFor(phaseIndex, subject.topic) : objectiveFor(phaseIndex, subject.topic)} This session covers only part ${partIndex + 1} of ${partCount}; the remaining content stays in later sessions.`
      : request.learningIntent === "learn" ? learningObjectiveFor(phaseIndex, subject.topic) : objectiveFor(phaseIndex, subject.topic),
    contentTargets,
    completionEvidence: request.learningIntent === "learn"
      ? learningCompletionEvidenceFor(phaseIndex, contentTargets)
      : completionEvidenceFor(phaseIndex, contentTargets),
  };
}

function outsideMethodFor(goal: string) {
  if (/essay|thesis|argument|draft|writing|evidence/i.test(goal)) return "Retrieval-based outlining";
  if (/calculus|math|algebra|equation|problem|solve|physics|chemistry/i.test(goal)) return "Worked example fading";
  if (/read|chapter|article|textbook/i.test(goal)) return "Read, recall, and review";
  return "Active retrieval with a source check";
}

function outsideMethodReason(goal: string) {
  if (/essay|thesis|argument|draft|writing|evidence/i.test(goal)) {
    return "A source-grounded outline turns the outside reading into claims and evidence before drafting, while keeping the factual content in the learner’s own materials.";
  }
  if (/calculus|math|algebra|equation|problem|solve|physics|chemistry/i.test(goal)) {
    return "One worked example from the learner’s source provides a model, then support should fade before an independent problem.";
  }
  if (/read|chapter|article|textbook/i.test(goal)) {
    return "Short reading segments followed by closed-source recall produce evidence of understanding without asking YOVA to replace the source.";
  }
  return "The learner should attempt the target from the trusted source, close it, and then produce evidence of what remains available without support.";
}

function contentTargetsFor(index: number, topic: string) {
  return [
    [`The core vocabulary and relationships in ${topic}`, `The current starting gaps revealed without notes`],
    [`A clear mental model of the weakest idea in ${topic}`, "One concrete example that shows how the idea works"],
    ["Choosing the correct idea in mixed situations", "Explaining why tempting alternatives do not fit"],
    ["Representative unsupported questions", "Errors repaired with a different follow-up prompt", "One independent transfer attempt"],
    ["The highest-priority ideas still due for retrieval"],
  ][index];
}

function completionEvidenceFor(index: number, targets: string[]) {
  const evidence = [
    "Attempt each target from memory and identify the unstable detail",
    "Explain the central relationship and complete one check without the model visible",
    "Choose and apply the correct idea in a new prompt",
    "Complete the assigned questions and correct each exposed error",
    "Retrieve the priority ideas once without notes",
  ][index];
  return [evidence, targets.length > 1 ? "Produce evidence for each listed content target" : "Produce evidence for the listed content target"];
}

function buildRationale(request: PlanGenerationRequest, preferences: PlanPreferenceContract) {
  const sourcePhrase = request.materialMode === "upload"
    ? `${request.materials.length} learner-supplied ${request.materials.length === 1 ? "source" : "sources"}`
    : "a YOVA-created content sequence";
  const executionPhrase = request.studyMode === "outside"
    ? "clear instructions that can be completed outside the app"
    : "guided work inside YOVA";

  if (request.intent === "study_now") {
    const approach = request.learningIntent === "learn"
      ? "teaches a compact foundation before guided and independent attempts"
      : "starts with an attempt from memory, then repairs only the exposed gaps";
    return `This focused session ${approach}. It uses ${sourcePhrase} and ${executionPhrase}, fits the time available now, and begins with ${preferences.presentation.label.toLowerCase()}.`;
  }

  const approach = request.learningIntent === "learn"
    ? "The plan builds an initial mental model, fades guidance, and then transitions into retrieval and application."
    : "The plan starts with retrieval to reveal exact gaps, then uses targeted explanation, retry, and later review.";
  return `${approach} It uses ${sourcePhrase} and ${executionPhrase}. Delivery begins with ${preferences.presentation.label.toLowerCase()}, uses ${preferences.support.label.toLowerCase()} after a miss, and plans ${preferences.retention.label.toLowerCase()} for later evidence.`;
}

function preferenceReasonFor(
  learningMode: "learn" | "study",
  phaseIndex: number,
  preferences: PlanPreferenceContract,
) {
  if (learningMode === "learn") return preferences.presentation.reason;
  if (phaseIndex >= 4) return preferences.retention.reason;
  return preferences.support.reason;
}

function studyNowTitle(subject: PreviewSubject) {
  return subject.sessionTitles[0].replace(/^(Retrieve|Recall)/, "Focused review:");
}

function learningTitleFor(title: string, index: number) {
  if (index !== 0) return title;
  return title.replace(/^(Retrieve|Recall)/, "Build a first model of");
}

function sessionLearningMode(request: PlanGenerationRequest, index: number) {
  if (request.intent === "study_now") return request.learningIntent;
  if (request.learningIntent === "study") return "study" as const;
  return index < 2 ? "learn" as const : "study" as const;
}

function objectiveFor(index: number, topic: string) {
  const objectives = [
    `Recall the main ideas in ${topic} without notes and expose unstable details.`,
    "Repair the weakest ideas with a concise explanation and a clear comparison.",
    "Use the repaired knowledge in mixed questions that require choosing the right idea.",
    "Complete a realistic assessment, then study only the errors that remain.",
    "Retrieve the highest-priority ideas once more before the deadline.",
  ];
  return objectives[index];
}

function learningObjectiveFor(index: number, topic: string) {
  return [
    `Build an accurate first mental model of ${topic} through a concise explanation and one concrete example.`,
    `Use a worked example to connect the main parts of ${topic}, then reconstruct the reasoning with less support.`,
    `Retrieve and distinguish the central ideas in ${topic} after the teaching model is hidden.`,
    `Apply the ideas in a new situation, diagnose any error, and retry without the original support.`,
    `Retrieve the highest-priority ideas in ${topic} after a delay and repair only what remains unstable.`,
  ][index];
}

function learningCompletionEvidenceFor(index: number, targets: string[]) {
  const evidence = [
    "Explain the central relationship in plain language after the model is hidden",
    "Complete one similar example with reduced support and explain the key decision",
    "Retrieve each central idea and distinguish it from a plausible alternative",
    "Complete one independent transfer attempt and correct any exposed error",
    "Retrieve the priority ideas once without notes after a delay",
  ][index];
  return [evidence, targets.length > 1 ? "Produce evidence for each listed content target" : "Produce evidence for the listed content target"];
}

function learningReasonFor(index: number) {
  return [
    "The learner is building this foundation, so YOVA should teach a coherent model before asking for unsupported recall.",
    "A complete example makes the reasoning visible before support is deliberately reduced.",
    "Retrieval now checks whether the taught model remains available without the explanation on screen.",
    "Independent application tests whether the learner can transfer the idea rather than repeat the example.",
    "A delayed return strengthens access to the idea while keeping review focused on what remains unstable.",
  ][index];
}

function reasonFor(index: number, request: PlanGenerationRequest) {
  const answers = request.diagnosticResponses.map((response) => response.answer).join(" ").toLowerCase();
  const hasIncorrectAnswer = request.diagnosticResponses.some((response) => response.evaluation === "incorrect");
  const confidenceIsLimited = hasIncorrectAnswer || /not confident|somewhat confident|i do not know/.test(answers);
  const reasons = [
    confidenceIsLimited
      ? "The starting check suggests recognition is stronger than independent recall."
      : "Retrieval verifies that confident recognition also holds without notes.",
    "A compact explanation follows retrieval so the learner repairs only the gaps that were exposed.",
    "Mixed practice checks whether the learner can distinguish ideas instead of memorizing isolated answers.",
    "A realistic assessment converts remaining mistakes into a targeted final review.",
    "A short final retrieval protects recall without adding unnecessary work before the deadline.",
  ];
  return reasons[index];
}

function upcomingFridayAtNine() {
  const date = new Date();
  const daysUntilFriday = (5 - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntilFriday);
  date.setHours(9, 0, 0, 0);
  return date;
}

function inferDeadline(goal: string) {
  return /next friday|test|exam|quiz|deadline/i.test(goal) ? upcomingFridayAtNine() : null;
}

function scheduledDate(index: number, totalSessions: number, window: string, deadline: Date | null) {
  if (deadline && index === totalSessions - 1) {
    const finalReview = new Date(deadline);
    finalReview.setHours(8, 0, 0, 0);
    return finalReview;
  }

  const date = new Date();
  const latestDayOffset = deadline
    ? Math.max(0, Math.floor((deadline.getTime() - date.getTime()) / (24 * 60 * 60 * 1_000)) - 1)
    : Math.max(0, totalSessions - 1);
  const dayOffset = totalSessions <= 1 ? 0 : Math.floor((index / (totalSessions - 1)) * latestDayOffset);
  date.setDate(date.getDate() + dayOffset);

  const hour = /morning/i.test(window) ? 8 : /evening/i.test(window) ? 18 : 15;
  date.setHours(hour, 30, 0, 0);
  return date;
}

function topicIdsForPreviewSession(request: PlanGenerationRequest, index: number, totalSessions: number) {
  const topics = request.knowledgeMap?.topics ?? [];
  if (!topics.length) return [crypto.randomUUID()];
  const sessionsPerTopic = Math.max(1, Math.floor(totalSessions / topics.length));
  const topicIndex = Math.min(topics.length - 1, Math.floor(index / sessionsPerTopic));
  return [topics[topicIndex].id];
}
