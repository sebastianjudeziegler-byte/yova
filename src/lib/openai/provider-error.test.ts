import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/openai/provider-error";

describe("classifyProviderError", () => {
  it.each([
    [{ name: "APIConnectionTimeoutError" }, "timeout"],
    [{ name: "RateLimitError", status: 429 }, "rate_limit"],
    [{ name: "AuthenticationError", status: 401 }, "authentication"],
    [{ name: "PermissionDeniedError", status: 403 }, "permission"],
    [{ name: "BadRequestError", status: 400 }, "invalid_request"],
    [{ name: "NotFoundError", status: 404 }, "not_found"],
    [{ name: "InternalServerError", status: 503 }, "provider_server_error"],
    [{ name: "APIConnectionError", code: "ECONNRESET" }, "connection"],
    [{ name: "AbortError", code: "ABORT_ERR" }, "aborted"],
  ])("classifies bounded provider metadata for %o", (error, category) => {
    expect(classifyProviderError(error)).toMatchObject({ category });
  });

  it("does not retain provider messages or unsafe codes", () => {
    expect(classifyProviderError({
      name: "APIError",
      status: 700,
      code: "private learner prompt: integrate x^2",
      message: "provider response included private learner content",
      response: { body: "private" },
    })).toEqual({
      category: "unknown",
      status: null,
      code: null,
    });
  });
});
