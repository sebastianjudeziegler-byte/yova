import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "scripts/check-readiness.mjs");

describe("production release readiness command", () => {
  it.each([
    ["SUPABASE_SECRET_KEY", "Supabase server secret"],
    ["YOVA_DRAFT_RECEIPT_SECRET", "Plan-draft receipt secret"],
  ])("fails when %s is absent", (variable, expectedCheck) => {
    const env = productionFixture();
    env[variable] = "";

    const result = runReadiness(["--production"], env);

    expect(result.status).toBe(1);
    expect(result.output).toContain(`FAIL  ${expectedCheck}`);
    expect(result.output).not.toContain("All production release readiness checks passed");
  });

  it("fails when the live Supabase capability contract cannot be reached", () => {
    const result = runReadiness(["--production"], productionFixture());

    expect(result.status).toBe(1);
    expect(result.output).toContain("FAIL  Signed-in generation database contract");
    expect(result.output).not.toContain("All production release readiness checks passed");
  });

  it("keeps fixture-only configuration validation explicit and non-releasable", () => {
    const result = runReadiness(
      ["--production", "--configuration-only"],
      productionFixture(),
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain("SKIP  Database capability probe");
    expect(result.output).toContain("Database capabilities were not checked");
    expect(result.output).toContain("not production release approval");
    expect(result.output).not.toContain("All production release readiness checks passed");
  });

  it("allows local compile builds without claiming cloud readiness", () => {
    const result = runReadiness(["--deployment"], {
      ...process.env,
      VERCEL_ENV: "",
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("production readiness is not being claimed");
  });

  it("allows Vercel Preview builds without requiring Production secrets", () => {
    const result = runReadiness(["--deployment"], {
      ...process.env,
      VERCEL_ENV: "preview",
      SUPABASE_SECRET_KEY: "",
      YOVA_DRAFT_RECEIPT_SECRET: "",
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("YOVA preview build");
    expect(result.output).toContain("production readiness is not being claimed");
  });

  it("runs the strict live gate for a Vercel Production build", () => {
    const result = runReadiness(["--deployment"], {
      ...productionFixture(),
      VERCEL_ENV: "production",
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain("YOVA production release readiness");
    expect(result.output).toContain("FAIL  Signed-in generation database contract");
  });
});

describe("release workflow wiring", () => {
  const packageJson = JSON.parse(readFileSync(
    resolve(process.cwd(), "package.json"),
    "utf8",
  )) as { scripts: Record<string, string> };
  const workflow = readFileSync(
    resolve(process.cwd(), ".github/workflows/quality.yml"),
    "utf8",
  );
  const smoke = readFileSync(
    resolve(process.cwd(), "scripts/smoke-deployment.mjs"),
    "utf8",
  );

  it("wires the automatic production deployment gate into builds", () => {
    expect(packageJson.scripts.prebuild).toBe("node scripts/check-readiness.mjs --deployment");
    expect(packageJson.scripts["readiness:production"]).toBe(
      "node scripts/check-readiness.mjs --production",
    );
  });

  it("does not present CI's fake credentials as a production release check", () => {
    expect(workflow).toContain("run: pnpm readiness:configuration");
    expect(workflow).not.toContain("run: pnpm readiness:production");
  });

  it("requires the deployed app to report signed-in generation readiness", () => {
    expect(smoke).toContain('signedInGeneration: "ready"');
  });
});

function runReadiness(args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 5_000,
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function productionFixture(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: "https://127.0.0.1:1",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_release_test",
    SUPABASE_SECRET_KEY: "sb_secret_release_test_value",
    OPENAI_API_KEY: "sk-release-test-not-a-real-key",
    CRON_SECRET: "release-test-cron-secret-000000000000000",
    YOVA_DRAFT_RECEIPT_SECRET: "release-test-draft-receipt-secret-000000000",
    YOVA_DRAFT_RECEIPT_PREVIOUS_SECRET: "",
    SITE_URL: "https://www.yovaapp.com",
    AUTH_PASSWORD_ACCOUNTS: "true",
    AUTH_INVITE_ONLY: "false",
    AUTH_CAPTCHA_ENABLED: "true",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    AUTH_EMAIL_CODE_VERIFICATION: "true",
    NEXT_PUBLIC_OPENAI_API_KEY: "",
    NEXT_PUBLIC_SUPABASE_SECRET_KEY: "",
    NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "",
    NEXT_PUBLIC_YOVA_DRAFT_RECEIPT_SECRET: "",
    VERCEL_ENV: "",
  };
}
