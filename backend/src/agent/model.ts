/**
 * The agent's view of a language model. The runner only depends on this
 * interface, so the provider can be swapped and tests can use a scripted model.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** A JSON Schema object describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  /** The provider's ID for this call, echoed back with its result. */
  id: string;
  name: string;
  /** The arguments as a JSON string, exactly as the model produced them. */
  arguments: string;
}

export interface ToolResult {
  callId: string;
  output: string;
}

export interface ModelRequest {
  instructions: string;
  tools: ToolDefinition[];
  /** Opaque state from the previous turn, so the model sees the whole conversation. */
  continuation?: string;
  userMessage?: string;
  toolResults?: ToolResult[];
  signal?: AbortSignal;
}

export interface ModelTurn {
  /** Text the model wrote this turn. Empty when it only called tools. */
  text: string;
  toolCalls: ToolCall[];
  /** Pass this back as `continuation` on the next request. */
  continuation: string;
}

export interface AgentModel {
  /** The model's name, shown to the buyer. Never contains credentials. */
  readonly name: string;
  respond(request: ModelRequest): Promise<ModelTurn>;
}
