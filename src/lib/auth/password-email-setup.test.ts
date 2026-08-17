import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("public password email setup documentation", () => {
  const setup = readFileSync(join(process.cwd(), "docs/PUBLIC-PASSWORD-ACCOUNTS.md"), "utf8");

  it("keeps signup and recovery links on scanner-safe token-hash confirmation pages", () => {
    expect(setup).toContain("/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup");
    expect(setup).toContain("/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery");
    expect(setup).toContain("Do not replace these links with `{{ .ConfirmationURL }}`");
  });

  it("requires CAPTCHA and a rollback path before public signup", () => {
    expect(setup).toContain("AUTH_CAPTCHA_ENABLED=true");
    expect(setup).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
    expect(setup).toContain('captchaClient: "turnstile"');
    expect(setup).toContain("does not prove Supabase enforces them");
    expect(setup).toContain("without a CAPTCHA token");
    expect(setup).toContain("Allow new users to sign up");
    expect(setup).toContain("## Rollback");
  });
});
