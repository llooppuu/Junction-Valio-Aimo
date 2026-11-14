import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { AGENT_TOOLS, compactForModel, executeTool, type AgentApi } from "../agent/tools.js";
import { PURCHASING_GUIDE } from "./guide.js";

/**
 * The Model Context Protocol server: the same interface as the REST API, for
 * any MCP-capable agent such as Claude, ChatGPT, or Cursor.
 *
 * It holds no rules of its own. Every tool is the built-in agent's tool, and
 * each call goes to the public API with the caller's own token, so the
 * buyer's rules, mandate, earned autonomy, and audit work exactly as they do
 * for any other client. There is no approval tool: approving is done in the
 * buyer's app.
 */

export const MCP_SERVER_NAME = "trusted-trade-agents";
export const MCP_SERVER_VERSION = "0.1.0";

/** Tools that only read, so a client can call them without asking the user each time. */
const READ_ONLY = new Set([
  "search_products",
  "compare_offers",
  "find_substitutes",
  "get_alerts",
  "review_standing_order",
  "get_suggestions",
  "find_recipes",
  "plan_menu",
  "get_my_policy",
  "get_quote",
  "get_shortfall_options",
]);

const TITLES: Record<string, string> = {
  search_products: "Search Valio Aimo's catalog",
  compare_offers: "Compare and rank offers",
  find_substitutes: "Find substitutes",
  get_alerts: "Read stock alerts",
  review_standing_order: "Review the standing order",
  renew_standing_order: "Renew the standing order as a quote",
  get_suggestions: "Read the wholesaler's suggestions",
  quote_suggestion: "Quote a suggestion",
  find_recipes: "Find recipes",
  plan_menu: "Plan a menu's order",
  get_my_policy: "Read my rules",
  create_quote: "Create a fixed-price quote",
  get_quote: "Read a quote",
  recheck_quote: "Recheck a quote against stock",
  get_shortfall_options: "Options for a shortfall",
  place_order: "Order an authorized quote",
};

const GUIDE_URI = "tta://purchasing-guide";
const POLICY_URI = "tta://policy";
const OPENAPI_URI = "tta://openapi";

export interface McpServerOptions {
  /** The REST API to call, with the caller's own token. */
  api: AgentApi;
}

/** A tool's answer for the agent: the API call, its one-line summary, and the data. */
function toolResult(execution: Awaited<ReturnType<typeof executeTool>>): CallToolResult {
  const failed = execution.httpStatus === 0 || execution.httpStatus >= 400;
  const data = compactForModel(execution.body);
  return {
    isError: failed,
    content: [
      {
        type: "text",
        text: `${execution.method} ${execution.path} → ${execution.httpStatus || "not sent"}: ${execution.summary}\n\n${JSON.stringify(data, null, 2)}`,
      },
    ],
    structuredContent: {
      httpStatus: execution.httpStatus,
      method: execution.method,
      path: execution.path,
      summary: execution.summary,
      ...(execution.quoteId ? { quoteId: execution.quoteId } : {}),
      ...(execution.orderId ? { orderId: execution.orderId } : {}),
      body: data as Record<string, unknown>,
    },
  };
}

async function readApi(api: AgentApi, path: string): Promise<string> {
  const response = await fetch(`${api.baseUrl}${path}`, { headers: { Authorization: `Bearer ${api.token}` } });
  return JSON.stringify(await response.json(), null, 2);
}

export function createMcpServer({ api }: McpServerOptions): Server {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION, title: "Trusted Trade Agents: purchasing from Valio Aimo" },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        "Purchase from Valio Aimo for a professional kitchen. Read your rules first (get_my_policy), compare offers that meet the buyer's requirements, create a fixed-price quote, and order it only when the server says it is within your authority. If a quote needs the buyer's approval, tell the buyer and stop: you cannot approve. The resource tta://purchasing-guide explains each step.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: AGENT_TOOLS.map((tool) => ({
      name: tool.name,
      title: TITLES[tool.name] ?? tool.name,
      description: tool.description,
      inputSchema: tool.parameters as { type: "object"; [key: string]: unknown },
      annotations: {
        title: TITLES[tool.name] ?? tool.name,
        readOnlyHint: READ_ONLY.has(tool.name),
        destructiveHint: false,
        // Quotes and orders are idempotent per quote: retrying an order returns the same order.
        idempotentHint: READ_ONLY.has(tool.name) || tool.name === "place_order",
        openWorldHint: true,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const execution = await executeTool(api, request.params.name, JSON.stringify(request.params.arguments ?? {}), extra.signal);
    return toolResult(execution);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: GUIDE_URI, name: "purchasing-guide", title: "Purchasing guide", mimeType: "text/markdown", description: "The steps from a need to an order, and what the server checks at each." },
      { uri: POLICY_URI, name: "policy", title: "My purchasing rules", mimeType: "application/json", description: "Your kitchen's rules, read-only: limits, allergens, attributes, earned autonomy." },
      { uri: OPENAPI_URI, name: "openapi", title: "The REST API", mimeType: "application/json", description: "The OpenAPI 3.1 document of the same interface." },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    if (uri === GUIDE_URI) return { contents: [{ uri, mimeType: "text/markdown", text: PURCHASING_GUIDE }] };
    if (uri === POLICY_URI) return { contents: [{ uri, mimeType: "application/json", text: await readApi(api, "/policy") }] };
    if (uri === OPENAPI_URI) return { contents: [{ uri, mimeType: "application/json", text: await readApi(api, "/openapi.json") }] };
    throw new Error(`Unknown resource ${uri}`);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "quote-a-need",
        title: "Order what the kitchen needs",
        description: "Turn a buyer's need into a fixed-price quote, and an order when it is within your authority.",
        arguments: [
          { name: "need", description: 'What the kitchen needs, for example "1,000 litres of lactose-free milk".', required: true },
          { name: "deliverBy", description: "Latest delivery date, YYYY-MM-DD.", required: false },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== "quote-a-need") throw new Error(`Unknown prompt ${request.params.name}`);
    const need = request.params.arguments?.need ?? "";
    const deliverBy = request.params.arguments?.deliverBy;
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `The kitchen needs: ${need}${deliverBy ? `, delivered by ${deliverBy}` : ""}. Read your rules with get_my_policy, compare offers that meet them with compare_offers, and create a quote for the best one with create_quote. If the quote is within your authority, place the order with place_order. If it needs the buyer's approval, say so and why, and stop.`,
          },
        },
      ],
    };
  });

  return server;
}
