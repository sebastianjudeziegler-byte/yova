export function isDevelopmentPreviewRequest(
  request: Request,
  nodeEnvironment = process.env.NODE_ENV,
) {
  if (nodeEnvironment !== "development") return false;
  if (request.headers.get("X-Yova-Development-Preview") === "guided-session") return true;

  const referrer = request.headers.get("referer");
  if (!referrer) return false;

  try {
    const url = new URL(referrer);
    const localHost = url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "[::1]";
    return localHost && url.searchParams.get("qa") === "preview";
  } catch {
    return false;
  }
}
