import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("tester email token-hash setup", () => {
  const setup = readFileSync(resolve(process.cwd(), "docs/TESTER-EMAIL-SETUP.md"), "utf8");

  it("routes both email templates through scanner-safe token-hash confirmation", () => {
    expect(setup).toContain(
      "/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email",
    );
    expect(setup).toContain(
      "/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite",
    );
    expect(setup).not.toContain('href="{{ .ConfirmationURL }}"');
  });
});
