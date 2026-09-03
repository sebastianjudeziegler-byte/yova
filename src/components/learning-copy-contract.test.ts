import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Learning copy contract", () => {
  it("normalizes plan and knowledge-map topic labels on Learning surfaces", () => {
    const component = readSource("src/components/yova-prototype.tsx");
    const learningStart = component.indexOf("function LearningScreen(");
    const learningEnd = component.indexOf("function AskScreen(", learningStart);
    const learning = component.slice(learningStart, learningEnd);

    expect(learningStart).toBeGreaterThan(-1);
    expect(learningEnd).toBeGreaterThan(learningStart);
    expect(learning).toContain("<p>{topicDisplayLabel(plan.topic)}</p>");
    expect(learning).not.toContain("<p>{plan.topic}</p>");
    expect(learning).toContain('topicDisplayLabel(topic.title, "This topic")');
    expect(learning).toContain('.map((title) => topicDisplayLabel(title, "This topic"))');
  });

  it("normalizes generated plan topic labels and content targets", () => {
    const creator = readSource("src/components/plan-creator.tsx");

    expect(creator).toContain("topicDisplayLabel(generatedPlan.plan.topic)");
    expect(creator).toContain("topicDisplayLabel(topic.title, workProductCopy");
    expect(creator).toContain("topicDisplayLabel(subtopic, workProductCopy");
    expect(creator).toContain('topicDisplayLabel(target, "This target")');
    expect(creator).not.toContain("<strong>{generatedPlan.plan.topic}</strong>");
  });
});
