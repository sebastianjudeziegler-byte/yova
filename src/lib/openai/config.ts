import "server-only";

export type OpenAIPlanConfig = {
  apiKey: string;
  model: string;
};

export type OpenAITutorConfig = OpenAIPlanConfig;
export type OpenAISessionConfig = OpenAIPlanConfig;
export type OpenAIAnswerEvaluationConfig = OpenAIPlanConfig;
export type OpenAIKnowledgeMapConfig = OpenAIPlanConfig;
export type OpenAILessonConfig = OpenAIPlanConfig;

export function getOpenAIPlanConfig(): OpenAIPlanConfig | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  return {
    apiKey,
    model: process.env.OPENAI_PLAN_MODEL?.trim() || "gpt-5.6",
  };
}

export function isOpenAIPlanConfigured() {
  return getOpenAIPlanConfig() !== null;
}

export function getOpenAITutorConfig(): OpenAITutorConfig | null {
  const planConfig = getOpenAIPlanConfig();
  if (!planConfig) return null;

  return {
    apiKey: planConfig.apiKey,
    model: process.env.OPENAI_TUTOR_MODEL?.trim() || planConfig.model,
  };
}

export function isOpenAITutorConfigured() {
  return getOpenAITutorConfig() !== null;
}

export function getOpenAISessionConfig(): OpenAISessionConfig | null {
  const planConfig = getOpenAIPlanConfig();
  if (!planConfig) return null;

  return {
    apiKey: planConfig.apiKey,
    // Plans benefit from deeper deliberation. A guided session is a bounded,
    // schema-constrained workload that must feel immediate in the product.
    model: process.env.OPENAI_SESSION_MODEL?.trim() || "gpt-5.4-mini",
  };
}

export function isOpenAISessionConfigured() {
  return getOpenAISessionConfig() !== null;
}

export function getOpenAIAnswerEvaluationConfig(): OpenAIAnswerEvaluationConfig | null {
  const sessionConfig = getOpenAISessionConfig();
  if (!sessionConfig) return null;

  return {
    apiKey: sessionConfig.apiKey,
    model: process.env.OPENAI_EVALUATION_MODEL?.trim() || sessionConfig.model,
  };
}

export function isOpenAIAnswerEvaluationConfigured() {
  return getOpenAIAnswerEvaluationConfig() !== null;
}

export function getOpenAIKnowledgeMapConfig(): OpenAIKnowledgeMapConfig | null {
  const planConfig = getOpenAIPlanConfig();
  if (!planConfig) return null;
  return {
    apiKey: planConfig.apiKey,
    model: process.env.OPENAI_KNOWLEDGE_MAP_MODEL?.trim() || "gpt-5.4-mini",
  };
}

export function getOpenAILessonConfig(): OpenAILessonConfig | null {
  const planConfig = getOpenAIPlanConfig();
  if (!planConfig) return null;

  return {
    apiKey: planConfig.apiKey,
    // Full teaching prose uses the stronger planning model. The bounded
    // session skeleton continues to use the faster session model.
    model: process.env.OPENAI_LESSON_MODEL?.trim() || planConfig.model,
  };
}

export function isOpenAILessonConfigured() {
  return getOpenAILessonConfig() !== null;
}
