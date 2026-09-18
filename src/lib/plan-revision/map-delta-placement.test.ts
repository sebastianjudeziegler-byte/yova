import { describe, expect, it } from "vitest";
import { deltaFixture, DELTA_NOW, deltaTopicId } from "@/evals/personalization-delta-fixture";
import { applyMapDelta, MapDeltaSchema } from "./map-delta";

describe("new topic position through the signed delta adapter", () => {
  it("places a new topic before an existing first topic", () => {
    const delta = MapDeltaSchema.parse({ operations: [{ op: "add_topic", title: "Energy foundations", description: "Understand energy before studying transfer.", before_topic_id: deltaTopicId(0) }] });
    const result = applyMapDelta({ request: deltaFixture(1).request, delta, now: DELTA_NOW });
    expect(result.request.knowledgeMap!.topics[0].title).toBe("Energy foundations");
    expect(result.request.knowledgeMap!.topics[1].id).toBe(deltaTopicId(0));
  });
  it("rejects contradictory positions and a foreign insertion anchor", () => {
    expect(MapDeltaSchema.safeParse({ operations: [{ op: "add_topic", title: "Foundations", description: "Understand energy transfer.", before_topic_id: deltaTopicId(0), after_topic_id: deltaTopicId(1) }] }).success).toBe(false);
    const delta = MapDeltaSchema.parse({ operations: [{ op: "add_topic", title: "Foundations", description: "Understand energy transfer.", before_topic_id: deltaTopicId(35) }] });
    expect(() => applyMapDelta({ request: deltaFixture(1).request, delta, now: DELTA_NOW })).toThrow(/not in this plan/i);
  });
});
