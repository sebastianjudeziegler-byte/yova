import { describe, expect, it } from "vitest";
import { validateSessionContentSpecificity } from "@/lib/session-generation/content-specificity";
import { GeneratedSessionDraftSchema } from "@/lib/session-generation/schema";

const baseDraft = GeneratedSessionDraftSchema.parse({
  rationale: "The learner needs a connected model of startup funding before comparing realistic financing decisions.",
  coverage: {
    focus: "Connect startup funding stages with dilution and investor decisions.",
    essentialIdeas: ["Funding stages and milestones", "Dilution changes founder ownership"],
    completionEvidence: ["Explain the stage sequence and apply dilution to one founder decision"],
    evidenceMap: [
      { essentialIdea: "Funding stages and milestones", activityConcept: "Funding stages" },
      { essentialIdea: "Dilution changes founder ownership", activityConcept: "Dilution" },
    ],
    deferredContent: [],
  },
  methodBriefing: {
    learningMode: "learn",
    taskType: "conceptual_learning",
    methodId: "self_explanation",
    name: "Connected concept model",
    what: "Study the funding sequence and explain how financing decisions change ownership.",
    why: "A connected model makes the stage names useful before the learner evaluates founder tradeoffs.",
    how: ["Follow one company through the funding stages.", "Explain the ownership tradeoff without the model visible."],
    completion: "Explain both target relationships and apply them to a new founder decision.",
    personalization: ["You asked for the big picture first, so the funding sequence appears before the terminology."],
  },
  sourceGrounding: null,
  activities: [
    {
      methodPhase: "model",
      concept: null,
      estimatedMinutes: 4,
      requiredForCompletion: true,
      label: "Learn",
      title: "Follow a startup through its funding stages",
      body: "Study how milestones, investors, and founder ownership change across the sequence.",
      teaching: {
        keyIdea: "Funding stages exchange ownership for resources needed to reach the next milestone.",
        explanation: "A startup may bootstrap first, raise pre-seed money to validate the problem, and raise seed money after early traction. Selling equity can supply resources, but dilution reduces the founders' percentage ownership.",
        example: {
          setup: "A founder owns all of a company before accepting an investor.",
          steps: ["The investor supplies capital for a defined milestone.", "The new shares reduce the founder's ownership percentage."],
          takeaway: "Funding can accelerate progress while changing control and ownership.",
        },
        commonMistake: null,
      },
      type: "instruction",
      choices: [],
      correctAnswer: null,
      feedback: null,
    },
    {
      methodPhase: "retrieve",
      concept: "Funding stages",
      estimatedMinutes: 3,
      requiredForCompletion: true,
      label: "Recall",
      title: "Match the stage to the milestone",
      body: "Which stage commonly follows early customer traction and supports repeatable growth?",
      teaching: null,
      type: "multiple_choice",
      choices: ["Seed", "Bootstrapping", "Idea only"],
      correctAnswer: "Seed",
      feedback: "Seed funding commonly follows early traction and supports product development and repeatable growth.",
    },
    {
      methodPhase: "explain",
      concept: "Dilution",
      estimatedMinutes: 4,
      requiredForCompletion: true,
      label: "Explain",
      title: "Explain the ownership tradeoff",
      body: "Explain why accepting an equity investment can help a startup while diluting the founders.",
      teaching: null,
      type: "free_response",
      choices: [],
      correctAnswer: "The investment supplies capital for growth, while issuing equity reduces the founders' percentage ownership.",
      feedback: "A strong answer connects new resources with the lower ownership percentage created by issuing equity.",
    },
  ],
});

describe("session content specificity", () => {
  it("accepts a subject-specific lesson that teaches the ideas it later checks", () => {
    expect(validateSessionContentSpecificity({
      draft: baseDraft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    })).toBeNull();
  });

  it("rejects generic placeholder teaching", () => {
    const draft = {
      ...baseDraft,
      activities: baseDraft.activities.map((activity, index) => index === 0 ? {
        ...activity,
        title: "See the first concept listed",
        body: "Study the provided context before answering the next question.",
        teaching: activity.teaching ? {
          ...activity.teaching,
          keyIdea: "The learner has not encountered the material.",
          explanation: "The learner has not encountered the material, so a general explanation should appear before a general check of the subject matter.",
        } : null,
      } : activity),
    };

    expect(validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    })).toContain("generic placeholder");
  });

  it("rejects an essential idea that is tested without being taught", () => {
    const draft = {
      ...baseDraft,
      coverage: {
        ...baseDraft.coverage,
        essentialIdeas: ["Funding stages and milestones", "Convertible note valuation caps"],
        evidenceMap: [
          { essentialIdea: "Funding stages and milestones", activityConcept: "Funding stages" },
          { essentialIdea: "Convertible note valuation caps", activityConcept: "Dilution" },
        ],
      },
    };

    expect(validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    })).toContain("are checked later but are not actually taught");
  });

  it("reports every essential idea that a learn session checks without teaching", () => {
    const draft = {
      ...baseDraft,
      coverage: {
        ...baseDraft.coverage,
        essentialIdeas: ["Convertible note valuation caps", "SAFE conversion discounts"],
        evidenceMap: [
          { essentialIdea: "Convertible note valuation caps", activityConcept: "Funding stages" },
          { essentialIdea: "SAFE conversion discounts", activityConcept: "Dilution" },
        ],
      },
    };

    const issue = validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    });

    expect(issue).toContain('"Convertible note valuation caps"');
    expect(issue).toContain('"SAFE conversion discounts"');
    expect(issue).toContain("move it to deferredContent");
  });

  it("rejects a correctly labeled check whose actual question tests something else", () => {
    const draft = {
      ...baseDraft,
      activities: baseDraft.activities.map((activity) => activity.concept === "Dilution" ? {
        ...activity,
        title: "Name a funding source",
        body: "Explain one reason a founder might bootstrap a company before seeking investors.",
        correctAnswer: "Bootstrapping lets a founder begin with personal funds or early revenue before raising outside capital.",
        feedback: "The answer should connect bootstrapping with personal funds or early business revenue.",
      } : activity),
    };

    expect(validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    })).toContain("The evidence map is inaccurate");
  });

  it("reports every inaccurate evidence mapping in one repair message", () => {
    const draft = {
      ...baseDraft,
      activities: baseDraft.activities.map((activity) => activity.type === "multiple_choice" ? {
        ...activity,
        title: "Explain the ownership tradeoff",
        body: "Which choice describes dilution after an equity investment?",
        choices: ["Founder ownership decreases", "Founder ownership increases", "Ownership never changes"],
        correctAnswer: "Founder ownership decreases",
        feedback: "Issuing equity reduces the founder's percentage ownership.",
      } : activity.type === "free_response" ? {
        ...activity,
        title: "Match a stage to a milestone",
        body: "Explain why a startup might raise seed funding after early traction.",
        correctAnswer: "Seed funding can support product development and repeatable growth after early customer traction.",
        feedback: "The explanation should connect the seed stage with early traction and the next growth milestone.",
      } : activity),
    };

    const issue = validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    });

    expect(issue).toContain('"Funding stages" does not test "Funding stages and milestones"');
    expect(issue).toContain('"Dilution" does not test "Dilution changes founder ownership"');
  });

  it("rejects a model that name-drops an idea without teaching its relationship", () => {
    const draft = {
      ...baseDraft,
      coverage: {
        ...baseDraft.coverage,
        essentialIdeas: ["Alliance commitments and mobilization widened a local crisis into a European war"],
        evidenceMap: [{
          essentialIdea: "Alliance commitments and mobilization widened a local crisis into a European war",
          activityConcept: "Funding stages",
        }],
      },
      activities: baseDraft.activities.map((activity, index) => index === 0 ? {
        ...activity,
        teaching: activity.teaching ? {
          ...activity.teaching,
          keyIdea: "Alliance commitments were important in World War I.",
          explanation: "European alliances existed before the conflict, and countries knew which other powers were connected. The model stops at that background fact and gives the learner no mechanism linking later events together.",
        } : null,
      } : activity),
    };

    expect(validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    })).toContain("are checked later but are not actually taught");
  });

  it("accepts a concise discrimination check that states the defining operation", () => {
    const arrayDraft = {
      ...baseDraft,
      coverage: {
        ...baseDraft.coverage,
        essentialIdeas: ["Filter creates a new array by keeping elements that pass a test"],
        evidenceMap: [{
          essentialIdea: "Filter creates a new array by keeping elements that pass a test",
          activityConcept: "Array method choice",
        }],
      },
      activities: baseDraft.activities.map((activity, index) => index === 0 ? {
        ...activity,
        title: "Compare three array methods",
        body: "Study what each method returns before choosing one.",
        teaching: activity.teaching ? {
          ...activity.teaching,
          keyIdea: "Filter creates a new array containing only elements that pass a test.",
          explanation: "Use filter when the output should contain a subset of the original array. The callback tests each element, and only elements that pass are kept in the new array.",
        } : null,
      } : index === 1 ? {
        ...activity,
        concept: "Array method choice",
        title: "Choose the array method",
        body: "Which method creates a new array containing only items that meet a condition?",
        choices: ["map", "filter", "reduce"],
        correctAnswer: "filter",
        feedback: "Filter keeps matching elements and returns them in a new array.",
      } : {
        ...activity,
        requiredForCompletion: false,
        concept: "Array method choice",
      }),
    };

    expect(validateSessionContentSpecificity({
      draft: arrayDraft,
      goalTopic: "JavaScript array methods",
      sessionObjective: "Choose between map, filter, and reduce",
    })).toBeNull();
  });

  it("rejects generic method instructions presented as if they were subject teaching", () => {
    const draft = {
      ...baseDraft,
      activities: baseDraft.activities.map((activity, index) => index === 0 ? {
        ...activity,
        title: "See the structure before trying it alone",
      } : activity),
    };

    expect(validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    })).toContain("generic placeholder");
  });

  it("rejects a grading rubric presented as the model answer", () => {
    const draft = {
      ...baseDraft,
      activities: baseDraft.activities.map((activity) => activity.type === "free_response" ? {
        ...activity,
        correctAnswer: "A strong response states the main idea behind startup funding stages and supports it with one relevant detail.",
      } : activity),
    };

    expect(validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    })).toContain("grading instructions instead of the actual subject answer");
  });

  it("rejects a session that repeats the same screen instead of progressing", () => {
    const first = baseDraft.activities[0];
    const draft = {
      ...baseDraft,
      activities: baseDraft.activities.map((activity, index) => index === 1 ? {
        ...activity,
        title: first.title,
        body: first.body,
      } : activity),
    };

    expect(validateSessionContentSpecificity({
      draft,
      goalTopic: "Startup funding stages, investors, and dilution",
      sessionObjective: "Explain the funding sequence and ownership tradeoffs",
    })).toContain("repeats the same activity");
  });
});
