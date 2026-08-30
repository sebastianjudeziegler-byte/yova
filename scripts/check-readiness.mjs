import { probeSignedInGenerationDatabase } from "./readiness-capability-probe.mjs";

const deploymentBuild = process.argv.includes("--deployment");
const configurationOnly = process.argv.includes("--configuration-only");
const productionDeployment = process.env.VERCEL_ENV === "production";
const production = process.argv.includes("--production")
  || (deploymentBuild && productionDeployment);

if (deploymentBuild && !productionDeployment) {
  const buildKind = process.env.VERCEL_ENV === "preview" ? "preview" : "local/CI";
  console.log(`YOVA ${buildKind} build: production readiness is not being claimed.`);
  console.log("Run pnpm readiness:production with the target environment before a release.");
  process.exit(0);
}

if (configurationOnly && !production) {
  console.error("--configuration-only is valid only with a production readiness check.");
  process.exit(1);
}

await loadNextEnvironment(!production);

const checks = [];
let databaseProbeSkipped = false;

function addCheck(name, passed, detail) {
  checks.push({ name, passed, detail });
}

function isHttpUrl(value, requireHttps = false) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return requireHttps ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function validDraftReceiptSecret(value) {
  return value.length >= 32 && value.length <= 4_096 && value === value.trim();
}

async function loadNextEnvironment(development) {
  try {
    const imported = await import("@next/env");
    const nextEnv = imported.default ?? imported;
    nextEnv.loadEnvConfig(process.cwd(), development);
  } catch (error) {
    if (!isMissingNextEnvironmentLoader(error)) throw error;
    // Deployment providers and CI inject configuration into process.env. If
    // dependencies are incomplete locally, the checks below still fail closed
    // for every absent production variable instead of crashing before them.
  }
}

function isMissingNextEnvironmentLoader(error) {
  return Boolean(error)
    && typeof error === "object"
    && "code" in error
    && error.code === "ERR_MODULE_NOT_FOUND"
    && "message" in error
    && typeof error.message === "string"
    && error.message.includes("@next/env");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim();
const cronSecret = process.env.CRON_SECRET ?? "";
const draftReceiptSecret = process.env.YOVA_DRAFT_RECEIPT_SECRET ?? "";
const previousDraftReceiptSecret = process.env.YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET ?? "";
const openAIKey = process.env.OPENAI_API_KEY?.trim();
const siteUrl = process.env.SITE_URL?.trim();
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  || process.env.VERCEL_URL?.trim();
const publicOrigin = siteUrl || (vercelUrl ? `https://${vercelUrl}` : "");
const passwordAccounts = process.env.AUTH_PASSWORD_ACCOUNTS === "true";
const inviteOnly = process.env.AUTH_INVITE_ONLY === "true";
const captchaEnabled = process.env.AUTH_CAPTCHA_ENABLED === "true";
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();

addCheck(
  "Supabase project URL",
  isHttpUrl(supabaseUrl, production),
  supabaseUrl ? "configured with a valid URL" : "missing NEXT_PUBLIC_SUPABASE_URL",
);
addCheck(
  "Supabase publishable key",
  Boolean(supabaseKey && supabaseKey.length >= 20),
  supabaseKey ? "configured" : "missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
);
addCheck(
  "OpenAI server key",
  Boolean(openAIKey && openAIKey.length >= 20),
  openAIKey ? "configured without exposing its value" : "missing OPENAI_API_KEY",
);
addCheck(
  "No public OpenAI key",
  !process.env.NEXT_PUBLIC_OPENAI_API_KEY,
  process.env.NEXT_PUBLIC_OPENAI_API_KEY
    ? "remove NEXT_PUBLIC_OPENAI_API_KEY immediately"
    : "the OpenAI key stays server-only",
);
addCheck(
  "No public Supabase secret",
  !process.env.NEXT_PUBLIC_SUPABASE_SECRET_KEY && !process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY,
  process.env.NEXT_PUBLIC_SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
    ? "remove the public Supabase secret immediately"
    : "the Supabase invitation secret stays server-only",
);
addCheck(
  "No public plan-draft secret",
  !process.env.NEXT_PUBLIC_YOVA_DRAFT_RECEIPT_SECRET,
  process.env.NEXT_PUBLIC_YOVA_DRAFT_RECEIPT_SECRET
    ? "remove NEXT_PUBLIC_YOVA_DRAFT_RECEIPT_SECRET immediately"
    : "the plan-draft signing key stays server-only",
);

if (production) {
  addCheck(
    "Supabase server secret",
    Boolean(supabaseSecretKey && supabaseSecretKey.length >= 20),
    supabaseSecretKey
      ? "configured for server-only plan activation permits and administrative workflows"
      : "missing SUPABASE_SECRET_KEY; production plan activation cannot mint a permit",
  );
  addCheck(
    "Account-export cleanup secret",
    cronSecret.length >= 32 && cronSecret === cronSecret.trim(),
    cronSecret.length >= 32 && cronSecret === cronSecret.trim()
      ? "configured without exposing its value"
      : "missing, short, or surrounded by whitespace in CRON_SECRET",
  );
  addCheck(
    "Plan-draft receipt secret",
    validDraftReceiptSecret(draftReceiptSecret),
    validDraftReceiptSecret(draftReceiptSecret)
      ? "configured without exposing its value"
      : "missing, outside 32-4096 characters, or surrounded by whitespace in YOVA_DRAFT_RECEIPT_SECRET",
  );
  addCheck(
    "Previous plan-draft receipt secret",
    !previousDraftReceiptSecret || validDraftReceiptSecret(previousDraftReceiptSecret),
    !previousDraftReceiptSecret
      ? "not set; no key rotation is active"
      : validDraftReceiptSecret(previousDraftReceiptSecret)
        ? "configured for the temporary receipt rotation window"
        : "outside 32-4096 characters or surrounded by whitespace in YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET",
  );
  if (passwordAccounts) {
    addCheck(
      "Public password account mode",
      !inviteOnly,
      !inviteOnly
        ? "public password account entry is selected"
        : "AUTH_INVITE_ONLY must be false when launching public password signup",
    );
    addCheck(
      "Authentication CAPTCHA",
      captchaEnabled && Boolean(turnstileSiteKey),
      captchaEnabled && turnstileSiteKey
        ? "the Turnstile client is required by the public account forms; verify provider enforcement separately"
        : "set AUTH_CAPTCHA_ENABLED=true and NEXT_PUBLIC_TURNSTILE_SITE_KEY before public signup",
    );
  } else {
    addCheck(
      "Invite-only account entry",
      inviteOnly,
      inviteOnly
        ? "new testers enter through founder invitations"
        : "enable either AUTH_INVITE_ONLY or AUTH_PASSWORD_ACCOUNTS",
    );
    if (captchaEnabled) {
      addCheck(
        "Invite sign-in CAPTCHA",
        Boolean(turnstileSiteKey),
        turnstileSiteKey
          ? "the Turnstile client is enabled for passwordless tester sign-in; verify provider enforcement separately"
          : "set NEXT_PUBLIC_TURNSTILE_SITE_KEY or disable AUTH_CAPTCHA_ENABLED",
      );
    }
  }
  addCheck(
    "Email code entry",
    process.env.AUTH_EMAIL_CODE_VERIFICATION === "true",
    process.env.AUTH_EMAIL_CODE_VERIFICATION === "true"
      ? "six-digit sign-in codes are enabled"
      : "set AUTH_EMAIL_CODE_VERIFICATION=true after adding {{ .Token }} to the email template",
  );
  addCheck(
    "Public site origin",
    Boolean(siteUrl) && isHttpUrl(publicOrigin, true) && !publicOrigin.includes("localhost"),
    siteUrl
      ? isHttpUrl(publicOrigin, true) && !publicOrigin.includes("localhost")
        ? "SITE_URL is configured with a public HTTPS origin"
        : "SITE_URL must be a public HTTPS origin and cannot use localhost"
      : vercelUrl
        ? "missing SITE_URL; a Vercel deploy URL is only a preview fallback, not the production canonical"
        : "missing SITE_URL; production requires the customer-facing HTTPS origin",
  );

  if (configurationOnly) {
    databaseProbeSkipped = true;
  } else if (
    isHttpUrl(supabaseUrl, true)
    && supabaseSecretKey
    && supabaseSecretKey.length >= 20
  ) {
    const databaseCapability = await probeSignedInGenerationDatabase({
      supabaseUrl,
      supabaseSecretKey,
    });
    addCheck(
      "Signed-in generation database contract",
      databaseCapability.passed,
      databaseCapability.detail,
    );
  } else {
    addCheck(
      "Signed-in generation database contract",
      false,
      "not probed because the HTTPS Supabase URL or SUPABASE_SECRET_KEY is unavailable",
    );
  }
} else {
  addCheck(
    "Local site origin",
    !siteUrl || isHttpUrl(siteUrl),
    siteUrl || "using http://localhost:3000",
  );
}

const failed = checks.filter((check) => !check.passed);

console.log(`YOVA ${production ? configurationOnly ? "production configuration" : "production release" : "local"} readiness`);
for (const check of checks) {
  console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
}
if (databaseProbeSkipped) {
  console.log("SKIP  Database capability probe: configuration-contract testing is not release approval");
}
console.log(`Models: plan=${process.env.OPENAI_PLAN_MODEL?.trim() || "gpt-5.6-sol"}, session=${process.env.OPENAI_SESSION_MODEL?.trim() || "gpt-5.4-mini"}, lesson=${process.env.OPENAI_LESSON_MODEL?.trim() || "same as plan"}, tutor=${process.env.OPENAI_TUTOR_MODEL?.trim() || "same as plan"}`);

if (failed.length) {
  console.error(`${failed.length} required readiness ${failed.length === 1 ? "check needs" : "checks need"} attention.`);
  process.exitCode = 1;
} else {
  if (configurationOnly) {
    console.log("Configuration shapes passed. Database capabilities were not checked; this is not production release approval.");
  } else if (production) {
    console.log("All production release readiness checks passed, including the live signed-in generation database contract.");
  } else {
    console.log("All required local configuration checks passed.");
  }
}
