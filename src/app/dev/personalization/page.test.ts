import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The inspector exposes learner-state internals and scoring arithmetic. It is a
 * development tool, and the only thing between it and the public site is this
 * gate, so the gate gets a test of its own.
 *
 * These assert on the not-found signal rather than on rendering. The component
 * returns JSX, which has no runtime in this environment, so "did it render"
 * cannot be asked here — but "did the gate fire" can, and that is the part
 * worth protecting.
 */

const NOT_FOUND_SIGNAL = /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/;

async function callPage(nodeEnvironment: string) {
  vi.stubEnv("NODE_ENV", nodeEnvironment);
  vi.resetModules();
  const { default: Page } = await import("@/app/dev/personalization/page");
  try {
    Page();
    return null;
  } catch (error) {
    return error;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the development personalization inspector route", () => {
  it("triggers the not-found gate in a production build", async () => {
    const error = await callPage("production");

    expect(error).not.toBeNull();
    expect(String((error as { digest?: string })?.digest ?? error)).toMatch(NOT_FOUND_SIGNAL);
  });

  it("does not trigger the gate in development", async () => {
    const error = await callPage("development");

    expect(String((error as { digest?: string })?.digest ?? error ?? "")).not.toMatch(NOT_FOUND_SIGNAL);
  });

  it("asks search engines not to index it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    const { metadata } = await import("@/app/dev/personalization/page");

    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
