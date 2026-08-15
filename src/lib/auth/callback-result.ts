export function describeAuthCallbackResult(result: string | null) {
  if (result === "invalid-link") {
    return "That sign-in link is incomplete or expired. Request a fresh link and open the newest email.";
  }

  if (result === "failed") {
    return "YOVA could not complete that sign-in. Open the newest email link in the same browser where you requested it, or request a fresh link.";
  }

  if (result === "invite-required") {
    return "This account does not have private-alpha access yet. Ask Sebastian to invite this exact email address.";
  }

  return null;
}
