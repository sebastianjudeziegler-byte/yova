export function describeAuthCallbackResult(result: string | null) {
  if (result === "invalid-link") {
    return "That account link is incomplete or expired. Request a fresh email and open the newest message from YOVA.";
  }

  if (result === "failed") {
    return "YOVA could not complete that account request. If you used a sign-in link, open the newest email in the same browser. Otherwise, request a fresh verification or reset link.";
  }

  if (result === "invite-required") {
    return "This account does not have private-alpha access yet. Ask Sebastian to invite this exact email address.";
  }

  return null;
}
