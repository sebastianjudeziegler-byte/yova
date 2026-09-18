import { describe, expect, it } from "vitest";
import { conceptMapAsProduce, conceptMapCanSubmit, conceptMapItems, removeMapConcept, validMapFeedback, type ConceptMapDraft } from "./concept-map";
import { initialShapeADraft } from "./shape-a";
import { loadBaselineCheckpoint, saveBaselineCheckpoint, type BaselineCheckpoint } from "./baseline-checkpoint";
const map: ConceptMapDraft = {
  concepts: [{ id: "water", label: "Water" }, { id: "potential", label: "Water potential" }, { id: "membrane", label: "Membrane" }],
  links: [{ id: "movement", from: "water", to: "potential", label: "moves down a gradient of" }, { id: "crosses", from: "water", to: "membrane", label: "crosses" }],
};
describe("guided concept map", () => {
  it("renaming a concept keeps relationships connected by identity", () => {
    const renamed = { ...map, concepts: map.concepts.map((concept) => concept.id === "water" ? { ...concept, label: "Water molecules" } : concept) };
    expect(conceptMapAsProduce(renamed).links[0]?.from).toBe("Water molecules");
    expect(renamed.links[0]?.from).toBe("water");
  });
  it("deleting a concept removes every connected link and retains unrelated concepts", () => {
    const reduced = removeMapConcept(map, "water");
    expect(reduced.links).toEqual([]);
    expect(reduced.concepts.map((concept) => concept.id)).toEqual(["potential", "membrane"]);
    expect(conceptMapCanSubmit(reduced)).toBe(false);
  });
  it("only named existing endpoints and a labelled relationship can be submitted", () => {
    expect(conceptMapCanSubmit(map)).toBe(true);
    expect(conceptMapCanSubmit({ ...map, links: [{ ...map.links[0]!, to: "unknown" }] })).toBe(false);
    expect(conceptMapCanSubmit({ ...map, links: [{ ...map.links[0]!, label: " " }] })).toBe(false);
    expect(conceptMapCanSubmit({ ...map, links: [{ ...map.links[0]!, to: "water" }] })).toBe(false);
    expect(conceptMapItems(map)[3]?.label).toBe("Water —moves down a gradient of→ Water potential");
  });
  it("only feedback addressing an existing item is attached to the map", () => {
    expect(validMapFeedback(map, [{ targetId: "movement", message: "Check the direction." }, { targetId: "invented", message: "Unknown." }])).toEqual([{ targetId: "movement", message: "Check the direction." }]);
  });
  it("preserves the final keystroke, original and revised maps, and timer settings across serialized checkpoints", () => {
    const draft = { ...initialShapeADraft(), text: "final keystroke Ω", map, repairText: "high to low", repairMap: { ...map, links: [{ ...map.links[0]!, label: "moves toward lower" }] } };
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
    const checkpoint = { version: 1, planId: "plan", planSessionId: "session", aState: { draft }, cState: { rounds: [] }, timer: { paused: true, hidden: true, extraMinutes: 5, acknowledgedLimit: 30 } } as unknown as BaselineCheckpoint;
    saveBaselineCheckpoint(storage, "account-a", checkpoint);
    const restored = loadBaselineCheckpoint(storage, "account-a", "session");
    expect(restored?.aState.draft).toEqual(draft);
    expect(restored?.timer).toEqual(checkpoint.timer);
    expect(loadBaselineCheckpoint(storage, "account-b", "session")).toBeNull();
  });
});
