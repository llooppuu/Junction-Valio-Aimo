import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

/**
 * The MCP server over stdio, for local clients such as Claude Desktop, Claude
 * Code, or Cursor. It is a thin client of the running API: each tool call goes
 * to TTA_API_URL with the agent's token from TTA_AGENT_TOKEN, so the server's
 * rules apply as they do for any other client.
 *
 *   TTA_AGENT_TOKEN=demo-agent-token npm run mcp
 */

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const baseUrl = (process.env.TTA_API_URL ?? `http://localhost:${process.env.BACKEND_PORT ?? "3001"}/api`).replace(/\/$/, "");
const token = process.env.TTA_AGENT_TOKEN ?? process.env.AGENT_TOKEN;
if (!token) {
  // stdout is the protocol channel, so problems go to stderr.
  console.error("Set TTA_AGENT_TOKEN to the agent's token, for example demo-agent-token.");
  process.exit(1);
}

const server = createMcpServer({ api: { baseUrl, token } });
await server.connect(new StdioServerTransport());
console.error(`Trusted Trade Agents MCP server on stdio, calling ${baseUrl}`);
