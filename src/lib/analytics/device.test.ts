import { describe, expect, it } from "vitest";
import { classifyAnalyticsDevice } from "@/lib/analytics/device";

describe("analytics device classification", () => {
  it("prefers the browser mobile hint", () => {
    expect(classifyAnalyticsDevice(new Headers({
      "sec-ch-ua-mobile": "?1",
      "user-agent": "Mozilla/5.0 Chrome/140 Safari/537.36",
    }))).toBe("mobile");
  });

  it("keeps tablets separate from phones", () => {
    expect(classifyAnalyticsDevice(new Headers({
      "user-agent": "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)",
    }))).toBe("tablet");
    expect(classifyAnalyticsDevice(new Headers({
      "user-agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile",
    }))).toBe("mobile");
  });

  it("classifies an ordinary browser without retaining its user agent", () => {
    expect(classifyAnalyticsDevice(new Headers({
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    }))).toBe("desktop");
  });

  it("uses unknown when the request has no device signal", () => {
    expect(classifyAnalyticsDevice(new Headers())).toBe("unknown");
  });
});
