import { randomUUID } from "node:crypto";
import { expect, test } from "./helpers/frozen-clock";
import { ShapeSlotResponseSchema } from "../src/lib/session-shapes/slots-schema";

// Live provider calls through the real development-preview endpoint. These
// are generation checks and retained samples, not authenticated persistence
// tests or evidence of how long a learner takes. Browser journeys are separate.
test.skip(process.env.YOVA_RUN_LIVE_BASELINE_PRACTICE !== "1", "The CI live gate supplies the model key.");
const topic = { id: "b729504a-8746-4ef3-a4c2-d3b7116c8138", title: "Osmosis", description: "Predict net water movement from water potential and explain the role of a partially permeable membrane.", subtopics: ["Water potential", "Membrane permeability", "Plant cell turgor"], taskType: "conceptual_learning", learningGoal: "Prepare for A-level Biology application questions: predict the effect of unfamiliar conditions on water movement and justify the mechanism." };
const modifiers = { instructionStyle: "standard", questionMix: { recall: 6, application: 12, compare_contrast: 6, prediction: 0, misconception: 0 }, produceStep: "typed_explanation", explanationFocus: "concept", questionCap: 24, questionTarget: 24, workloadBounded: true };
const base = () => ({ requestId: randomUUID(), recoveryKey: randomUUID(), planId: randomUUID(), planSessionId: randomUUID(), topic, modifiers, tips: [] });
const headers = { "X-Yova-Development-Preview": "guided-session" };

for (const count of [6, 24]) {
  test(`a live ${count}-question ${count === 6 ? "introductory factual" : "application"} workload is complete and preserves topic binding`, async ({ request }, testInfo) => {
    test.setTimeout(180_000);
    const selectedTopic = count === 6 ? { ...topic, title: "Plant cell structures", description: "Identify the cell wall, nucleus, chloroplast and vacuole and recall their functions.", subtopics: ["Cell wall", "Nucleus", "Chloroplast", "Vacuole"], taskType: "memorization", learningGoal: "Learn the basic plant cell structures and their functions for an introductory secondary-school biology quiz." } : topic;
    const input = { ...base(), topic: selectedTopic, action: "learn_block", modifiers: { ...modifiers, ...(count === 6 ? { questionMix: { recall: 6, application: 0, compare_contrast: 0, prediction: 0, misconception: 0 } } : {}), questionCap: count, questionTarget: count } };
    const response = await request.post("/api/sessions/shape", { headers, data: input, timeout: 65_000 });
    const body = await response.json();
    await testInfo.attach(`live-${count}-question-workload.json`, { body: Buffer.from(JSON.stringify({ environment: "CI development-preview; real model; no database", input, status: response.status(), output: body }, null, 2)), contentType: "application/json" });
    expect(response.status(), JSON.stringify(body)).toBe(200);
    const parsed = ShapeSlotResponseSchema.parse(body);
    expect(parsed.action).toBe("learn_block");
    if (parsed.action !== "learn_block") return;
    expect(parsed.questions).toHaveLength(count);
    expect(parsed.keyPoints.every(point => point.sourceTopicId === topic.id)).toBe(true);
    expect(new Set(parsed.questions.map(question => question.prompt)).size).toBe(count);
    expect(parsed.questions.some(question => question.kind === (count === 6 ? "recall" : "application"))).toBe(true);
    for (const question of parsed.questions) {
      expect(question.prompt).not.toMatch(/(?:study guide|syllabus|course outline|unit\s+\d+\s+(?:lists|covers))/i);
      expect(question.choices).toHaveLength(4);
      expect(question.keyPointIds.every(id => parsed.keyPoints.some(point => point.id === id))).toBe(true);
    }
  });
}

test("live comparison distinguishes an unchanged osmosis misconception from a repaired explanation", async ({ request }, testInfo) => {
  test.setTimeout(180_000);
  const originalProduced = "Water moves by osmosis from higher solute concentration to lower solute concentration.";
  const reference = { excerpts: [{ label: "Teaching notes", text: "Osmosis is the net movement of water across a partially permeable membrane from higher water potential to lower water potential. In dilute solutions under the same pressure, increasing solute concentration lowers water potential. Water therefore moves from the more dilute solution toward the more concentrated solution. The solute cannot cross the membrane." }], keyPoints: [] };
  const originalComparison = { feedback: "The direction of water movement is reversed.", missing: [], incorrect: ["Water moves toward lower water potential, not away from it."] };
  const samples = [];
  for (const [label, produced] of [
    ["incorrect", "Water moves from the more concentrated solution to the more dilute solution across the membrane."],
    ["correct", "Across a partially permeable membrane, net water movement is from higher to lower water potential. Under equal pressure, that means from the more dilute side to the more concentrated side; the solute cannot cross."],
  ] as const) {
    const input = { ...base(), action: "compare", produced, reference, revision: { originalProduced, originalComparison } };
    const response = await request.post("/api/sessions/shape", { headers, data: input, timeout: 65_000 });
    const output = await response.json(); samples.push({ label, input, status: response.status(), output });
    expect(response.status(), JSON.stringify(output)).toBe(200);
    const parsed = ShapeSlotResponseSchema.parse(output);
    expect(parsed.action).toBe("compare");
    if (parsed.action !== "compare") continue;
    if (label === "incorrect") expect(parsed.incorrect.length).toBeGreaterThan(0);
    else expect(parsed.incorrect).toEqual([]);
  }
  await testInfo.attach("live-osmosis-revision-quality.json", { body: Buffer.from(JSON.stringify(samples, null, 2)), contentType: "application/json" });
});
