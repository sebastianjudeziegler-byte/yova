import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const readinessScript = fileURLToPath(
  new URL("../../scripts/check-readiness.mjs", import.meta.url),
);

type EnvironmentOverrides = {
  [name: string]: string | undefined;
  NODE_ENV?: NodeJS.ProcessEnv["NODE_ENV"];
};

const validEnvironment: NodeJS.ProcessEnv = {
  AUTH_EMAIL_CODE_VERIFICATION: "true",
  AUTH_INVITE_ONLY: "true",
  AUTH_PASSWORD_ACCOUNTS: "false",
  CRON_SECRET: "c".repeat(32),
  FORCE_COLOR: "0",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "p".repeat(20),
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NODE_ENV: "test",
  OPENAI_API_KEY: "o".repeat(20),
  SUPABASE_SECRET_KEY: "s".repeat(20),
  YOVA_DRAFT_RECEIPT_SECRET: "d".repeat(32),
};

function runReadiness(
  args: string[],
  environment: EnvironmentOverrides,
) {
  const childEnvironment: NodeJS.ProcessEnv = {
    ...validEnvironment,
    ...environment,
    NODE_ENV: environment.NODE_ENV ?? validEnvironment.NODE_ENV ?? "test",
  };

  return spawnSync(process.execPath, [readinessScript, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: childEnvironment,
  });
}

describe("production public site readiness", () => {
  it("rejects a Vercel deploy URL fallback as the production canonical", () => {
    const result = runReadiness(["--production", "--configuration-only"], {
      VERCEL_PROJECT_PRODUCTION_URL: "yova-roan.vercel.app",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL  Public site origin: missing SITE_URL; a Vercel deploy URL is only a preview fallback, not the production canonical",
    );
  });

  it("accepts an explicit customer-facing SITE_URL in production", () => {
    const result = runReadiness(["--production", "--configuration-only"], {
      SITE_URL: "https://www.yovaapp.com",
      VERCEL_PROJECT_PRODUCTION_URL: "yova-roan.vercel.app",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PASS  Public site origin: SITE_URL is configured with a public HTTPS origin",
    );
  });

  it("fails production readiness without a private plan-draft signing key", () => {
    const result = runReadiness(["--production", "--configuration-only"], {
      SITE_URL: "https://www.yovaapp.com",
      YOVA_DRAFT_RECEIPT_SECRET: undefined,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL  Plan-draft receipt secret: missing, outside 32-4096 characters, or surrounded by whitespace in YOVA_DRAFT_RECEIPT_SECRET",
    );
  });

  it("fails production readiness without the server-only plan activation permit issuer", () => {
    const result = runReadiness(["--production", "--configuration-only"], {
      SITE_URL: "https://www.yovaapp.com",
      SUPABASE_SECRET_KEY: undefined,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "FAIL  Supabase server secret: missing SUPABASE_SECRET_KEY; production plan activation cannot mint a permit",
    );
  });

  it("keeps the Vercel fallback acceptable outside production readiness", () => {
    const result = runReadiness([], {
      VERCEL_PROJECT_PRODUCTION_URL: "yova-preview.vercel.app",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "PASS  Local site origin: using http://localhost:3000",
    );
  });
});
