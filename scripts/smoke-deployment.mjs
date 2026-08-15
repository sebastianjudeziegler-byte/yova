const suppliedUrl = process.argv
  .slice(2)
  .find((argument) => argument !== "--" && !argument.startsWith("-"))
  ?.trim() || process.env.YOVA_DEPLOYMENT_URL?.trim();

function fail(message) {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS  ${message}`);
}

function deploymentOrigin(value) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(url.hostname)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "User-Agent": "YOVA-production-smoke/1.0",
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
}

const origin = deploymentOrigin(suppliedUrl);

if (!origin) {
  console.error("Usage: pnpm smoke:production -- https://your-yova-domain.com");
  console.error("The target must be a public HTTPS URL, not localhost.");
  process.exit(1);
}

console.log(`YOVA production smoke test\nTarget: ${origin}`);

try {
  const homeResponse = await request(`${origin}/`);
  const homeHtml = await homeResponse.text();

  if (homeResponse.ok) pass(`Home page responded with ${homeResponse.status}`);
  else fail(`Home page responded with ${homeResponse.status}`);

  if (/YOVA/i.test(homeHtml)) pass("Home page contains the YOVA identity");
  else fail("Home page did not contain the YOVA identity");

  const requiredHeaders = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
  };

  for (const [header, expected] of Object.entries(requiredHeaders)) {
    const actual = homeResponse.headers.get(header);
    if (actual === expected) pass(`${header} security header is active`);
    else fail(`${header} expected ${expected}, received ${actual || "nothing"}`);
  }

  if (homeResponse.headers.get("strict-transport-security")) {
    pass("HTTPS strict transport security is active");
  } else {
    fail("Strict-Transport-Security header is missing");
  }

  if (!homeResponse.headers.get("x-powered-by")) pass("Framework identity header is hidden");
  else fail("x-powered-by should not be exposed");

  for (const [path, identity] of [
    ["/privacy", /Privacy Notice/i],
    ["/terms", /Private Alpha Terms/i],
    ["/support", /YOVA Support/i],
  ]) {
    const trustResponse = await request(`${origin}${path}`);
    const trustHtml = await trustResponse.text();
    if (trustResponse.ok && identity.test(trustHtml)) pass(`${path} trust page is available`);
    else fail(`${path} trust page was not available or had unexpected content`);
  }

  const monitoringResponse = await request(`${origin}/api/errors`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      surface: "route_boundary",
      errorCode: "production_smoke_signal",
      routePath: "/",
    }),
  });
  if (monitoringResponse.status === 204) pass("Privacy-safe error intake fails silently for signed-out visitors");
  else fail(`Error intake returned ${monitoringResponse.status} instead of 204`);

  const statusResponse = await request(`${origin}/api/system/status`, {
    headers: { Accept: "application/json" },
  });
  const status = await statusResponse.json().catch(() => null);

  if (statusResponse.ok && status) pass("System status endpoint returned valid JSON");
  else fail(`System status endpoint failed with ${statusResponse.status}`);

  const expectedModes = {
    planGeneration: "openai",
    guidedSessions: "openai",
    tutor: "openai",
    materials: "private-supabase",
    persistence: "supabase",
    authentication: "supabase-email",
    testerAccess: "invite-only",
    testerInvitations: "founder-managed",
    emailVerification: "code-and-link",
    publicSignup: "disabled",
  };

  for (const [capability, expected] of Object.entries(expectedModes)) {
    const actual = status?.[capability];
    if (actual === expected) pass(`${capability} is using ${expected}`);
    else fail(`${capability} expected ${expected}, received ${actual || "nothing"}`);
  }

  const cacheControl = statusResponse.headers.get("cache-control") || "";
  if (cacheControl.includes("no-store")) pass("Capability status is not publicly cached");
  else fail("Capability status should use Cache-Control: no-store");

  const callbackResponse = await request(`${origin}/auth/callback`, { redirect: "manual" });
  const callbackLocation = callbackResponse.headers.get("location");
  const expectedCallback = `${origin}/?auth=invalid-link`;

  if ([302, 303, 307, 308].includes(callbackResponse.status) && callbackLocation === expectedCallback) {
    pass("Invalid authentication links return safely to YOVA");
  } else {
    fail(`Authentication callback recovery was unexpected (${callbackResponse.status}, ${callbackLocation || "no redirect"})`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "The deployment could not be reached");
}

if (process.exitCode) {
  console.error("Production smoke test found a launch-readiness problem.");
} else {
  console.log("All public production smoke checks passed.");
}
