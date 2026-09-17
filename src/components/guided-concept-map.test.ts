import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuidedConceptMap } from "./guided-concept-map";

const value = { concepts: [{ id: "c1", label: "Water" }, { id: "c2", label: "Membrane" }], links: [{ id: "l1", from: "c1", to: "c2", label: "crosses" }] };
describe("guided map visible controls", () => {
  it("renders a visible map and keyboard-operable endpoints that select existing concepts", () => {
    const html = renderToStaticMarkup(createElement(GuidedConceptMap, { value, onChange: () => {} }));
    expect(html).toContain('<svg');
    expect(html).toContain('aria-label="Link 1 from"');
    expect(html).toContain('<option value="c1" selected="">Water</option>');
    expect(html).toContain('Water —crosses→ Membrane');
    expect(html).toContain('Remove concept 1');
    expect(html).toContain('Add relationship');
  });
  it("associates feedback with the named relationship and keeps the original map read-only", () => {
    const html = renderToStaticMarkup(createElement(GuidedConceptMap, { value, label: "Original map", feedback: [{ targetId: "l1", message: "Name the selectively permeable membrane." }] }));
    expect(html).toContain('aria-label="Original map"');
    expect(html).toContain('data-map-item-id="l1"');
    expect(html).toContain('Name the selectively permeable membrane.');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('Add relationship');
  });
});
