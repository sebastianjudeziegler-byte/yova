import { z } from "zod";

const EMAIL_LIKE_PATTERN = /\b[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+\b/i;
const REPORT_LINK_PATTERN = /study-profile(?:%2f|\/)report(?:%2f|\/)[A-Za-z0-9_-]{32,128}/i;
const LABELED_TOKEN_PATTERN = /(?:report|token)[^A-Za-z0-9_-]{0,12}[A-Za-z0-9_-]{32,128}/i;
const LONG_URL_SAFE_VALUE_PATTERN = /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{40,}(?:$|[^A-Za-z0-9_-])/;

function decodedAttributionVariants(value: string) {
  const variants = [value];
  let current = value;

  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current.replaceAll("+", "%20"));
      if (decoded === current) break;
      variants.push(decoded);
      current = decoded;
    } catch {
      break;
    }
  }

  return variants;
}

/** Detects likely direct identifiers and private bearer values in attribution. */
export function isSensitiveStudyProfileAttributionValue(value: string) {
  return decodedAttributionVariants(value).some((variant) => (
    EMAIL_LIKE_PATTERN.test(variant)
    || REPORT_LINK_PATTERN.test(variant)
    || LABELED_TOKEN_PATTERN.test(variant)
    || LONG_URL_SAFE_VALUE_PATTERN.test(variant)
  ));
}

export function sanitizeStudyProfileAttributionValue(
  value: string | null | undefined,
  maxLength: number,
) {
  if (!value) return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!normalized || isSensitiveStudyProfileAttributionValue(normalized)) return null;
  return normalized.slice(0, maxLength);
}

export function createStudyProfileAttributionValueSchema(
  maxLength: number,
  options: { requireNonempty?: boolean } = {},
) {
  const base = z.string().trim().max(maxLength);
  const lengthBounded = options.requireNonempty ? base.min(1) : base;
  return lengthBounded.refine(
    (value) => !isSensitiveStudyProfileAttributionValue(value),
    "Attribution must not contain an email address or private report token.",
  );
}
