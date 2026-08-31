import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  MethodLibrary,
  METHOD_LIBRARY_MAX_PREFERENCES,
  toggleMethodLibraryPreference,
  visibleMethodLibrarySaveStatus,
} from "@/components/method-library";
import {
  CORE_METHOD_CATALOG,
  CORE_METHOD_IDS,
} from "@/lib/learning/method-catalog";

function renderLibrary(preferredMethodIds: (typeof CORE_METHOD_IDS)[number][] = []) {
  return renderToStaticMarkup(createElement(MethodLibrary, {
    preferredMethodIds,
    onPreferredMethodIdsChange: vi.fn(),
  }));
}

describe("MethodLibrary", () => {
  it("renders all twelve live methods from the canonical catalog", () => {
    const html = renderLibrary();

    expect(html.match(/data-method-id=/g)).toHaveLength(12);
    expect(html.match(/Available now/g)).toHaveLength(12);
    for (const methodId of CORE_METHOD_IDS) {
      const method = CORE_METHOD_CATALOG[methodId];
      expect(html).toContain(`data-method-id="${methodId}"`);
      expect(html).toContain(`>${method.name}</h2>`);
      expect(html).toContain(method.what);
      expect(html).toContain(method.why);
      expect(html).toContain(method.completion);
      expect(html).toContain(method.avoidWhen);
      for (const step of method.how) expect(html).toContain(step);
    }
  });

  it("exposes native details and named pressed-state preference controls", () => {
    const html = renderLibrary(["retrieval_practice", "scaffolded_coding"]);

    expect(html.match(/<details class="method-library-details">/g)).toHaveLength(12);
    expect(html.match(/<summary>How it works<\/summary>/g)).toHaveLength(12);
    expect(html).toContain('role="list" aria-label="Available study methods"');
    expect(html.match(/role="listitem"/g)).toHaveLength(12);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(10);
    expect(html.match(/Prefer when it fits/g)).toHaveLength(12);
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain("<strong>2</strong> of 3 preferred");
    expect(html).toContain("Changes save automatically.");
    expect(html).toContain('aria-busy="false"');
  });

  it("disables only unselected controls after three preferences", () => {
    const html = renderLibrary([
      "retrieval_practice",
      "self_explanation",
      "worked_example_fading",
    ]);

    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="false"[^>]* disabled=""/g)).toHaveLength(9);
    expect(html.match(/aria-pressed="true"[^>]* disabled=""/g)).toBeNull();
    expect(html).toContain("Remove one preference before adding another.");
  });

  it("explains when stated preferences are saved but paused", () => {
    const html = renderToStaticMarkup(createElement(MethodLibrary, {
      preferredMethodIds: ["retrieval_practice"],
      onPreferredMethodIdsChange: vi.fn(),
      statedPreferencesEnabled: false,
    }));

    expect(html).toContain("Your choices are saved");
    expect(html).toContain("Use what I tell YOVA");
  });

  it("adds, removes, canonicalizes, and caps the UI preference set", () => {
    expect(toggleMethodLibraryPreference([], "self_explanation")).toEqual([
      "self_explanation",
    ]);
    expect(toggleMethodLibraryPreference(
      ["self_explanation", "retrieval_practice", "self_explanation"],
      "retrieval_practice",
    )).toEqual(["self_explanation"]);
    expect(toggleMethodLibraryPreference(
      ["retrieval_practice", "spaced_retrieval", "self_explanation"],
      "worked_example_fading",
    )).toEqual(["retrieval_practice", "spaced_retrieval", "self_explanation"]);
    expect(METHOD_LIBRARY_MAX_PREFERENCES).toBe(3);
  });

  it("clears a pending message after a later profile sync succeeds", () => {
    expect(visibleMethodLibrarySaveStatus(
      "pending",
      "retrieval_practice|self_explanation",
      "retrieval_practice",
    )).toBe("pending");
    expect(visibleMethodLibrarySaveStatus(
      "pending",
      "retrieval_practice|self_explanation",
      "retrieval_practice|self_explanation",
    )).toBe("saved");
    expect(visibleMethodLibrarySaveStatus(
      "saving",
      "retrieval_practice",
      "retrieval_practice",
    )).toBe("saving");
    expect(visibleMethodLibrarySaveStatus(
      "pending",
      null,
      "retrieval_practice",
    )).toBe("pending");
  });
});
