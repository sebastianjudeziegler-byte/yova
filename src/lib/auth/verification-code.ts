export const EMAIL_VERIFICATION_CODE_LENGTH = 6;

export function normalizeEmailVerificationCode(value: string) {
  return value.replace(/\D/g, "").slice(0, EMAIL_VERIFICATION_CODE_LENGTH);
}

export function isCompleteEmailVerificationCode(value: string) {
  return new RegExp(`^\\d{${EMAIL_VERIFICATION_CODE_LENGTH}}$`).test(value);
}
