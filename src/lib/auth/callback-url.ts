export function safeAuthCallbackUrl(origin: string, requestedNext: string) {
  const fallback = new URL("/", origin);

  if (
    !requestedNext.startsWith("/")
    || requestedNext.startsWith("//")
    || requestedNext.includes("\\")
  ) {
    return fallback;
  }

  try {
    const destination = new URL(requestedNext, fallback);
    return destination.origin === fallback.origin ? destination : fallback;
  } catch {
    return fallback;
  }
}
