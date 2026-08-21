import { describe, expect, it } from "vitest";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from "openai";
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

  it.each([
    [new APIConnectionTimeoutError(), "timeout"],
    [new APIConnectionError({ message: "private learner content" }), "connection"],
    [new APIUserAbortError({ message: "private learner content" }), "aborted"],
  ])("classifies real OpenAI SDK subclasses whose Error name is generic", (error, category) => {
    expect(error.name).toBe("Error");
    expect(classifyProviderError(error)).toEqual({
      category,
      status: null,
      code: null,
    });
  });

  it.each([
    ["rate_limit_error", "rate_limit"],
    ["invalid_request_error", "invalid_request"],
    ["server_error", "provider_server_error"],
  ])("uses a bounded provider type identity %s", (type, category) => {
    const error = Object.assign(new Error("private provider message"), { type });
    expect(classifyProviderError(error)).toEqual({
      category,
      status: null,
      code: null,
    });
  });

  it("does not retain provider messages or unsafe codes", () => {
    expect(classifyProviderError({
      name: "APIError",
      status: 700,
      code: "private learner prompt: integrate x^2",
      type: "private learner prompt: integrate x^2",
      message: "provider response included private learner content",
      response: { body: "private" },
    })).toEqual({
      category: "unknown",
      status: null,
      code: null,
    });
  });

  it("ignores inaccessible provider identity fields without throwing", () => {
    const error = new Proxy(new Error("private provider message"), {
      get() {
        throw new Error("private getter content");
      },
      getPrototypeOf() {
        throw new Error("private prototype content");
      },
    });

    expect(classifyProviderError(error)).toEqual({
      category: "unknown",
      status: null,
      code: null,
    });
  });
});
