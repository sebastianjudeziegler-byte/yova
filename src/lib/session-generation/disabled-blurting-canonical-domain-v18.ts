import { z } from "zod";

/**
 * Exact ECMAScript TrimString edge set pinned for the V18 canonical domain.
 *
 * This list deliberately excludes characters such as U+0085, U+180E, and
 * U+200B. Runtime Unicode-table changes must not silently change a signed or
 * digested V18 string boundary.
 */
export const DISABLED_BLURTING_TRIM_STRING_CODE_POINTS_V18 = Object.freeze([
  0x0009,
  0x000a,
  0x000b,
  0x000c,
  0x000d,
  0x0020,
  0x00a0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
] as const);

const TRIM_STRING_CODE_POINT_SET_V18 = new Set<number>(
  DISABLED_BLURTING_TRIM_STRING_CODE_POINTS_V18,
);

const CANONICAL_INSTANT_PATTERN_V18 =
  /^(?!0000-)\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;

/**
 * Canonical V18 database instant: UTC, exact millisecond precision, and a
 * four-digit Common Era year. The Date round-trip rejects impossible calendar
 * values rather than accepting JavaScript's normalization of them.
 */
export const DisabledBlurtingCanonicalInstantV18Schema = z.string().refine(
  isDisabledBlurtingCanonicalInstantV18,
  "V18 instants require exact YYYY-MM-DDTHH:mm:ss.sssZ UTC spelling.",
);

export type DisabledBlurtingCanonicalTextV18Options = Readonly<{
  minCodePoints: number;
  maxCodePoints: number;
  /** Require the exact input to have no pinned TrimString character at either edge. */
  trim?: boolean;
}>;

/**
 * Creates a reject-only V18 text schema. It never trims, normalizes, or
 * otherwise rewrites the accepted string, and all size limits count Unicode
 * code points rather than UTF-16 code units.
 */
export function disabledBlurtingCanonicalTextV18Schema(
  options: DisabledBlurtingCanonicalTextV18Options,
) {
  const { minCodePoints, maxCodePoints, trim = true } = options;
  if (
    !Number.isSafeInteger(minCodePoints)
    || !Number.isSafeInteger(maxCodePoints)
    || minCodePoints < 0
    || maxCodePoints < minCodePoints
  ) {
    throw new RangeError("V18 text bounds require ordered non-negative safe integers.");
  }

  return z.string().superRefine((value, context) => {
    const codePointLength = disabledBlurtingUnicodeScalarLengthV18(value);
    if (codePointLength === null) {
      context.addIssue({
        code: "custom",
        message: "V18 text requires Unicode scalar values and forbids NUL.",
      });
      return;
    }
    if (codePointLength < minCodePoints || codePointLength > maxCodePoints) {
      context.addIssue({
        code: "custom",
        message: `V18 text requires ${minCodePoints} to ${maxCodePoints} Unicode code points.`,
      });
    }
    if (trim && !isDisabledBlurtingTrimStringCanonicalV18(value)) {
      context.addIssue({
        code: "custom",
        message: "V18 text cannot have a pinned ECMAScript TrimString character at either edge.",
      });
    }
  });
}

export function isDisabledBlurtingCanonicalInstantV18(value: string) {
  if (!CANONICAL_INSTANT_PATTERN_V18.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/** Returns null for NUL or an unpaired UTF-16 surrogate. */
export function disabledBlurtingUnicodeScalarLengthV18(value: string) {
  let codePointLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) return null;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) return null;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return null;
    }
    codePointLength += 1;
  }
  return codePointLength;
}

export function isDisabledBlurtingTrimStringCanonicalV18(value: string) {
  if (value.length === 0) return true;
  const first = value.codePointAt(0);
  const last = value.codePointAt(value.length - 1);
  return (
    first !== undefined
    && last !== undefined
    && !TRIM_STRING_CODE_POINT_SET_V18.has(first)
    && !TRIM_STRING_CODE_POINT_SET_V18.has(last)
  );
}
