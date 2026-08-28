import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const production = process.argv.includes("--production");
loadEnvConfig(process.cwd(), !production);

const checks = [];

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim();
const cronSecret = process.env.CRON_SECRET ?? "";
const draftReceiptSecret = process.env.YOVA_DRAFT_RECEIPT_SECRET ?? "";
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
    draftReceiptSecret.length >= 32 && draftReceiptSecret === draftReceiptSecret.trim(),
    draftReceiptSecret.length >= 32 && draftReceiptSecret === draftReceiptSecret.trim()
      ? "configured without exposing its value"
      : "missing, short, or surrounded by whitespace in YOVA_DRAFT_RECEIPT_SECRET",
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
} else {
  addCheck(
    "Local site origin",
    !siteUrl || isHttpUrl(siteUrl),
    siteUrl || "using http://localhost:3000",
  );
}

const failed = checks.filter((check) => !check.passed);

console.log(`YOVA ${production ? "production" : "local"} readiness`);
for (const check of checks) {
  console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
}
console.log(`Models: plan=${process.env.OPENAI_PLAN_MODEL?.trim() || "gpt-5.6-sol"}, session=${process.env.OPENAI_SESSION_MODEL?.trim() || "gpt-5.4-mini"}, lesson=${process.env.OPENAI_LESSON_MODEL?.trim() || "same as plan"}, tutor=${process.env.OPENAI_TUTOR_MODEL?.trim() || "same as plan"}`);

if (failed.length) {
  console.error(`${failed.length} required readiness ${failed.length === 1 ? "check needs" : "checks need"} attention.`);
  process.exitCode = 1;
} else {
  console.log("All required configuration checks passed.");
}
