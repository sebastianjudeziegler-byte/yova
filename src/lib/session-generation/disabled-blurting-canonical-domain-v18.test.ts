import { describe, expect, it } from "vitest";
import {
  DISABLED_BLURTING_TRIM_STRING_CODE_POINTS_V18,
  DisabledBlurtingCanonicalInstantV18Schema,
  disabledBlurtingCanonicalTextV18Schema,
  disabledBlurtingUnicodeScalarLengthV18,
  isDisabledBlurtingCanonicalInstantV18,
  isDisabledBlurtingTrimStringCanonicalV18,
} from "@/lib/session-generation/disabled-blurting-canonical-domain-v18";

describe("disabled Blurting V18 canonical TypeScript domain", () => {
  it("accepts only exact millisecond UTC instants in years 0001 through 9999", () => {
    for (const instant of [
      "0001-01-01T00:00:00.000Z",
      "2024-02-29T23:59:59.999Z",
      "9999-12-31T23:59:59.999Z",
    ]) {
      expect(DisabledBlurtingCanonicalInstantV18Schema.parse(instant)).toBe(instant);
      expect(isDisabledBlurtingCanonicalInstantV18(instant)).toBe(true);
    }

    for (const instant of [
      "0000-01-01T00:00:00.000Z",
      "+010000-01-01T00:00:00.000Z",
      "2023-02-29T00:00:00.000Z",
      "2026-02-31T00:00:00.000Z",
      "2026-01-01T24:00:00.000Z",
      "2026-01-01T00:00:60.000Z",
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00.00Z",
      "2026-01-01T00:00:00.0000Z",
      "2026-01-01T00:00:00.000+00:00",
      "2026-01-01T01:00:00.000+01:00",
      "2026-01-01 00:00:00.000Z",
      "2026-01-01t00:00:00.000z",
    ]) {
      expect(DisabledBlurtingCanonicalInstantV18Schema.safeParse(instant).success)
        .toBe(false);
      expect(isDisabledBlurtingCanonicalInstantV18(instant)).toBe(false);
    }
  });

  it("pins every ECMAScript TrimString edge and excludes historical lookalikes", () => {
    expect(DISABLED_BLURTING_TRIM_STRING_CODE_POINTS_V18).toEqual([
      0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x00a0, 0x1680,
      0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
      0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
      0xfeff,
    ]);
    const schema = disabledBlurtingCanonicalTextV18Schema({
      minCodePoints: 1,
      maxCodePoints: 20,
    });
    for (const codePoint of DISABLED_BLURTING_TRIM_STRING_CODE_POINTS_V18) {
      const edge = String.fromCodePoint(codePoint);
      expect(isDisabledBlurtingTrimStringCanonicalV18(`${edge}text`)).toBe(false);
      expect(isDisabledBlurtingTrimStringCanonicalV18(`text${edge}`)).toBe(false);
      expect(schema.safeParse(`${edge}text`).success).toBe(false);
      expect(schema.safeParse(`text${edge}`).success).toBe(false);
      expect(schema.parse(`te${edge}xt`)).toBe(`te${edge}xt`);
    }
    for (const nonTrimCodePoint of [0x0085, 0x180e, 0x200b]) {
      const edge = String.fromCodePoint(nonTrimCodePoint);
      expect(schema.parse(`${edge}text${edge}`)).toBe(`${edge}text${edge}`);
    }
  });

  it("requires valid non-NUL Unicode scalar text and counts code points", () => {
    const twoCodePoints = disabledBlurtingCanonicalTextV18Schema({
      minCodePoints: 2,
      maxCodePoints: 2,
    });
    expect(twoCodePoints.parse("A😀")).toBe("A😀");
    expect(disabledBlurtingUnicodeScalarLengthV18("A😀")).toBe(2);
    expect(twoCodePoints.safeParse("😀").success).toBe(false);
    expect(twoCodePoints.safeParse("A😀B").success).toBe(false);

    for (const invalid of [
      "A\u0000B",
      "\ud800",
      "\udfff",
      "A\ud800B",
      "A\udfffB",
    ]) {
      expect(disabledBlurtingUnicodeScalarLengthV18(invalid)).toBeNull();
      expect(twoCodePoints.safeParse(invalid).success).toBe(false);
    }
  });

  it("preserves accepted text exactly without trim or Unicode normalization", () => {
    const schema = disabledBlurtingCanonicalTextV18Schema({
      minCodePoints: 1,
      maxCodePoints: 10,
    });
    const composed = "é";
    const decomposed = "e\u0301";

    expect(schema.parse(composed)).toBe(composed);
    expect(schema.parse(decomposed)).toBe(decomposed);
    expect(schema.parse(decomposed)).not.toBe(composed);
    expect([...schema.parse(decomposed)]).toHaveLength(2);
    expect(schema.safeParse(" text ").success).toBe(false);
  });

  it("rejects invalid schema bounds at construction", () => {
    expect(() => disabledBlurtingCanonicalTextV18Schema({
      minCodePoints: -1,
      maxCodePoints: 2,
    })).toThrow(RangeError);
    expect(() => disabledBlurtingCanonicalTextV18Schema({
      minCodePoints: 3,
      maxCodePoints: 2,
    })).toThrow(RangeError);
    expect(() => disabledBlurtingCanonicalTextV18Schema({
      minCodePoints: 1.5,
      maxCodePoints: 2,
    })).toThrow(RangeError);
  });
});
