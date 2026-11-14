import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Router, type Request, type Response } from "express";
import { createMcpServer } from "../mcp/server.js";
import type { Store } from "../store.js";

/**
 * The MCP server over Streamable HTTP, at POST /api/mcp. Stateless: each
 * request gets its own server, bound to the caller's token, so nothing is
 * shared between agents. It accepts agent tokens only; approving belongs to
 * the buyer's app.
 */
export function mcpRouter(store: Store) {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
    const principal = token ? store.principals.find((candidate) => candidate.token === token) : undefined;
    if (!principal) {
      res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "Missing or invalid credentials. Send Authorization: Bearer <agent token>." });
      return;
    }
    if (principal.role !== "agent") {
      res.status(403).json({ error: "The MCP server is for purchasing agents. A buyer approves in the buyer's app." });
      return;
    }

    // The tools call the public API on this same server, with the agent's own token.
    const server = createMcpServer({ api: { baseUrl: `http://127.0.0.1:${req.socket.localPort}/api`, token: principal.token } });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless: there is no server-sent event stream to open with GET, and no session to end with DELETE.
  router.use((req: Request, res: Response, next) => {
    if (req.method === "POST") return next();
    res.status(405).set("Allow", "POST").json({ error: "Send MCP messages with POST." });
  });

  return router;
}
