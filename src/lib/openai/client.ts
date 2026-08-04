import "server-only";
import OpenAI from "openai";
import { getOpenAIPlanConfig } from "@/lib/openai/config";

let cachedClient: OpenAI | null = null;
let cachedKey: string | null = null;

export function getOpenAIClient() {
  const config = getOpenAIPlanConfig();
  if (!config) throw new Error("OpenAI is not configured on the YOVA server.");

  if (!cachedClient || cachedKey !== config.apiKey) {
    cachedClient = new OpenAI({
      apiKey: config.apiKey,
      maxRetries: 2,
      timeout: 45_000,
    });
    cachedKey = config.apiKey;
  }

  return cachedClient;
}
