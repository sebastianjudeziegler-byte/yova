import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getOpenAILessonConfig,
  getOpenAIPlanConfig,
  getOpenAISessionConfig,
} from "@/lib/openai/config";

const originalEnvironment = {
  apiKey: process.env.OPENAI_API_KEY,
  planModel: process.env.OPENAI_PLAN_MODEL,
  sessionModel: process.env.OPENAI_SESSION_MODEL,
  lessonModel: process.env.OPENAI_LESSON_MODEL,
};

afterEach(() => {
  restoreEnvironmentVariable("OPENAI_API_KEY", originalEnvironment.apiKey);
  restoreEnvironmentVariable("OPENAI_PLAN_MODEL", originalEnvironment.planModel);
  restoreEnvironmentVariable("OPENAI_SESSION_MODEL", originalEnvironment.sessionModel);
  restoreEnvironmentVariable("OPENAI_LESSON_MODEL", originalEnvironment.lessonModel);
});

describe("OpenAI model configuration", () => {
  it("uses deployed, role-specific defaults", () => {
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_PLAN_MODEL;
    delete process.env.OPENAI_SESSION_MODEL;
    delete process.env.OPENAI_LESSON_MODEL;

    expect(getOpenAIPlanConfig()?.model).toBe("gpt-5.6-sol");
    expect(getOpenAISessionConfig()?.model).toBe("gpt-5.4-mini");
    expect(getOpenAILessonConfig()?.model).toBe("gpt-5.6-sol");
  });

  it("keeps explicit model overrides", () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_PLAN_MODEL = "plan-override";
    process.env.OPENAI_SESSION_MODEL = "session-override";
    process.env.OPENAI_LESSON_MODEL = "lesson-override";

    expect(getOpenAIPlanConfig()?.model).toBe("plan-override");
    expect(getOpenAISessionConfig()?.model).toBe("session-override");
    expect(getOpenAILessonConfig()?.model).toBe("lesson-override");
  });
});

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
