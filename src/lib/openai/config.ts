import "server-only";

export type OpenAIPlanConfig = {
  apiKey: string;
  model: string;
};

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
