import OpenAI from "openai";
import type { AgentModel, ModelRequest, ModelTurn } from "./model.js";

export interface OpenAiModelOptions {
  apiKey: string;
  model: string;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
}

/**
 * An AgentModel backed by the OpenAI Responses API. The conversation is kept by
 * OpenAI and referenced with `previous_response_id`, which also carries the
 * model's reasoning between tool calls.
 */
export function createOpenAiModel(options: OpenAiModelOptions): AgentModel {
  const client = new OpenAI({ apiKey: options.apiKey, maxRetries: 2, timeout: 90_000 });

  return {
    name: options.model,
    async respond(request: ModelRequest): Promise<ModelTurn> {
      const input: OpenAI.Responses.ResponseInputItem[] = [];
      if (request.userMessage !== undefined) {
        input.push({ role: "user", content: request.userMessage });
      }
      for (const result of request.toolResults ?? []) {
        input.push({ type: "function_call_output", call_id: result.callId, output: result.output });
      }

      const response = await client.responses.create(
        {
          model: options.model,
          instructions: request.instructions,
          reasoning: { effort: options.reasoningEffort },
          previous_response_id: request.continuation ?? null,
          input,
          tools: request.tools.map((tool) => ({
            type: "function" as const,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: false,
          })),
        },
        { signal: request.signal },
      );

      return {
        text: response.output_text ?? "",
        toolCalls: response.output.flatMap((item) =>
          item.type === "function_call"
            ? [{ id: item.call_id, name: item.name, arguments: item.arguments }]
            : [],
        ),
        continuation: response.id,
      };
    },
  };
}
