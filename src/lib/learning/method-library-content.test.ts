import { describe, expect, it } from "vitest";
import {
  CORE_METHOD_CATALOG,
  CORE_METHOD_IDS,
} from "@/lib/learning/method-catalog";
import { METHOD_LIBRARY_ENTRIES } from "@/lib/learning/method-library-content";

describe("method library content", () => {
  it("projects every live core method once in canonical order", () => {
    expect(METHOD_LIBRARY_ENTRIES).toHaveLength(12);
    expect(METHOD_LIBRARY_ENTRIES.map((method) => method.id)).toEqual(CORE_METHOD_IDS);
    expect(new Set(METHOD_LIBRARY_ENTRIES.map((method) => method.id)).size).toBe(12);

    for (const method of METHOD_LIBRARY_ENTRIES) {
      const canonical = CORE_METHOD_CATALOG[method.id];
      expect(method.name).toBe(canonical.name);
      expect(method.what).toBe(canonical.what);
      expect(method.why).toBe(canonical.why);
      expect(method.how).toEqual(canonical.how);
      expect(method.completion).toBe(canonical.completion);
      expect(method.avoidWhen).toBe(canonical.avoidWhen);
      expect(method.bestFor.length).toBeGreaterThan(20);
      expect(method.taskLabels).toHaveLength(canonical.taskTypes.length);
    }
  });

  it("freezes the public library projection", () => {
    expect(Object.isFrozen(METHOD_LIBRARY_ENTRIES)).toBe(true);
    expect(METHOD_LIBRARY_ENTRIES.every((method) => (
      Object.isFrozen(method)
      && Object.isFrozen(method.how)
      && Object.isFrozen(method.taskLabels)
    ))).toBe(true);
  });
});
