export function describeAuthCallbackResult(result: string | null) {
  if (result === "invalid-link") {
    return "That sign-in link is incomplete or expired. Request a fresh link and open the newest email.";
  }

  if (result === "failed") {
    return "YOVA could not complete that sign-in. Open the newest email link in the same browser where you requested it, or request a fresh link.";
  }

  return null;
}
