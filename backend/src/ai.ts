import { createGeminiModel } from "./agent/gemini-model.js";
import type { AgentModel } from "./agent/model.js";
import { createOpenAiModel } from "./agent/openai-model.js";
import { config } from "./config.js";
import { geminiListReader, openAiListReader, type ListReader } from "./services/listReader.js";

/**
 * Which AI provider runs the agent and reads list photos: OpenAI or Gemini.
 * AI_PROVIDER chooses; without it, OpenAI is used when its key is set, and
 * Gemini otherwise. The keys are read only here, on the server.
 */
export type AiProvider = "openai" | "gemini";

export function aiProvider(): AiProvider | undefined {
  if (config.AI_PROVIDER === "openai") return config.OPENAI_API_KEY ? "openai" : undefined;
  if (config.AI_PROVIDER === "gemini") return config.GEMINI_API_KEY ? "gemini" : undefined;
  if (config.OPENAI_API_KEY) return "openai";
  if (config.GEMINI_API_KEY) return "gemini";
  return undefined;
}

/** What to set when no provider is configured. */
export const AI_KEY_HINT = "Set GEMINI_API_KEY or OPENAI_API_KEY in .env";

export function defaultAgentModel(): AgentModel | null {
  switch (aiProvider()) {
    case "openai":
      return createOpenAiModel({ apiKey: config.OPENAI_API_KEY!, model: config.OPENAI_MODEL, reasoningEffort: config.OPENAI_REASONING_EFFORT });
    case "gemini":
      return createGeminiModel({ apiKey: config.GEMINI_API_KEY!, model: config.GEMINI_MODEL, reasoningEffort: config.GEMINI_REASONING_EFFORT });
    default:
      return null;
  }
}

export function defaultListReader(): ListReader | null {
  switch (aiProvider()) {
    case "openai":
      return openAiListReader(config.OPENAI_API_KEY!, config.OPENAI_MODEL);
    case "gemini":
      return geminiListReader(config.GEMINI_API_KEY!, config.GEMINI_MODEL);
    default:
      return null;
  }
}
