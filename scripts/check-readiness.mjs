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
const openAIKey = process.env.OPENAI_API_KEY?.trim();
const siteUrl = process.env.SITE_URL?.trim();
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  || process.env.VERCEL_URL?.trim();
const publicOrigin = siteUrl || (vercelUrl ? `https://${vercelUrl}` : "");

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

if (production) {
  addCheck(
    "Public site origin",
    isHttpUrl(publicOrigin, true) && !publicOrigin.includes("localhost"),
    publicOrigin
      ? "configured with a public HTTPS origin"
      : "set SITE_URL or deploy through Vercel",
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
