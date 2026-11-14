import { GoogleGenAI, ThinkingLevel, type Content, type Part } from "@google/genai";
import type { AgentModel, ModelRequest, ModelTurn } from "./model.js";

export interface GeminiModelOptions {
  apiKey: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  /** Stands in for the Gemini client in tests. */
  client?: Pick<GoogleGenAI, "models">;
}

const THINKING: Record<GeminiModelOptions["reasoningEffort"], ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/** One conversation so far: every turn as Gemini returned it, and the names of the calls awaiting results. */
interface History {
  contents: Content[];
  pendingCalls: Map<string, string>;
}

/** How many conversations are remembered. The oldest is forgotten first. */
const MAX_CONVERSATIONS = 500;

/**
 * An AgentModel backed by Gemini's generateContent with function calling.
 * Gemini keeps no conversation on its side, so the history is kept here and
 * referenced by the continuation ID. Each model turn is stored exactly as
 * returned, thought signatures included, which Gemini needs back to carry its
 * reasoning across tool calls.
 */
export function createGeminiModel(options: GeminiModelOptions): AgentModel {
  const ai = options.client ?? new GoogleGenAI({ apiKey: options.apiKey });
  const histories = new Map<string, History>();
  let nextId = 1;
  let nextCall = 1;

  return {
    name: options.model,
    async respond(request: ModelRequest): Promise<ModelTurn> {
      // An unknown continuation, for example after a restart, starts the conversation afresh.
      const previous = request.continuation ? histories.get(request.continuation) : undefined;
      const contents = [...(previous?.contents ?? [])];

      const parts: Part[] = [];
      for (const result of request.toolResults ?? []) {
        const name = previous?.pendingCalls.get(result.callId);
        if (!name) continue;
        parts.push({ functionResponse: { id: result.callId, name, response: { output: parseOutput(result.output) } } });
      }
      if (request.userMessage !== undefined) parts.push({ text: request.userMessage });
      if (parts.length > 0) contents.push({ role: "user", parts });

      const response = await ai.models.generateContent({
        model: options.model,
        contents,
        config: {
          systemInstruction: request.instructions,
          thinkingConfig: { thinkingLevel: THINKING[options.reasoningEffort] },
          ...(request.tools.length > 0
            ? {
                tools: [
                  {
                    functionDeclarations: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parametersJsonSchema: tool.parameters,
                    })),
                  },
                ],
              }
            : {}),
          ...(request.signal ? { abortSignal: request.signal } : {}),
        },
      });

      const content = response.candidates?.[0]?.content;
      if (!content?.parts?.length) {
        const reason = response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason ?? "no answer";
        throw new Error(`Gemini returned no content (${reason}).`);
      }
      contents.push({ role: "model", parts: content.parts });

      const pendingCalls = new Map<string, string>();
      const toolCalls = content.parts.flatMap((part) => {
        if (!part.functionCall?.name) return [];
        // Gemini may leave the ID out; the name is what its function response must carry.
        const id = part.functionCall.id ?? `call-${nextCall++}`;
        part.functionCall.id = id;
        pendingCalls.set(id, part.functionCall.name);
        return [{ id, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) }];
      });
      const text = content.parts
        .filter((part) => typeof part.text === "string" && !part.thought)
        .map((part) => part.text)
        .join("");

      const continuation = `gemini-${nextId++}`;
      histories.set(continuation, { contents, pendingCalls });
      if (histories.size > MAX_CONVERSATIONS) histories.delete(histories.keys().next().value!);
      return { text, toolCalls, continuation };
    },
  };
}

/** Tool results are JSON text; Gemini takes them as objects. */
function parseOutput(output: string): unknown {
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}
