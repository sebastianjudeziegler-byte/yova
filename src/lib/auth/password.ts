export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;
export const AUTH_EMAIL_MAX_LENGTH = 254;
export const DISPLAY_NAME_MAX_LENGTH = 80;

export function normalizeAuthEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function validateAuthEmail(value: string) {
  const email = normalizeAuthEmail(value);
  if (!email || email.length > AUTH_EMAIL_MAX_LENGTH) return "Enter a valid email address.";

  const atIndex = email.indexOf("@");
  if (atIndex < 1 || atIndex !== email.lastIndexOf("@") || atIndex === email.length - 1) {
    return "Enter a valid email address.";
  }

  const domain = email.slice(atIndex + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return "Enter a valid email address.";
  }

  return null;
}

export function validatePassword(value: string) {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  if (new TextEncoder().encode(value).byteLength > PASSWORD_MAX_BYTES) {
    return "Use a shorter password (72 bytes or fewer).";
  }

  return null;
}

export function validateDisplayName(value: string) {
  const displayName = normalizeDisplayName(value);
  if (!displayName) return "Enter your first name.";
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) return "Use 80 characters or fewer for your name.";
  return null;
}
