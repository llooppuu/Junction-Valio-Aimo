import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AGENT, BUYER, startTestServer, type TestServer, testStore } from "./helpers.js";

/**
 * The MCP server: any MCP client gets the agent's tools, and every call goes
 * through the API with the agent's token, so the same rules apply.
 */

async function connect(server: TestServer, token: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

type Structured = { httpStatus: number; summary: string; quoteId?: string; body: any };
const structured = (result: unknown) => (result as { structuredContent: Structured }).structuredContent;

describe("the MCP server", () => {
  let server: TestServer;
  let client: Client;
  before(async () => {
    server = await startTestServer({ store: testStore({ autonomy: "earned" }) });
    client = await connect(server, AGENT);
  });
  after(async () => {
    await client.close();
    await server.close();
  });

  it("identifies itself and lists the agent's 16 tools, marking the read-only ones", async () => {
    assert.equal(client.getServerVersion()?.name, "trusted-trade-agents");
    const { tools } = await client.listTools();
    assert.equal(tools.length, 16);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.get("compare_offers")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("place_order")?.annotations?.readOnlyHint, false);
    assert.equal(byName.get("create_quote")?.inputSchema.type, "object");
  });

  it("runs the brief's request through the API, and the server's rules decide", async () => {
    const offers = structured(
      await client.callTool({
        name: "compare_offers",
        arguments: { category: "milk", attributes: ["lactose-free"], unit: "litre", minQuantity: 1000, rankBy: "price" },
      }),
    );
    assert.equal(offers.httpStatus, 200);
    assert.match(offers.summary, /^Ranked by price: 464306/);

    const quote = await client.callTool({
      name: "create_quote",
      arguments: { lines: [{ productId: "464306", amount: 1000, unit: "litre" }], requirements: { attributes: ["lactose-free"] } },
    });
    const body = structured(quote).body;
    assert.equal(structured(quote).httpStatus, 201);
    // Milk is not yet an earned category, so the quote waits for the buyer, exactly as over REST.
    assert.equal(body.quote.status, "needs_approval");
    assert.ok(body.quote.permission.checks.some((check: { rule: string; outcome: string }) => check.rule === "earned_autonomy" && check.outcome === "needs_approval"));

    const order = await client.callTool({ name: "place_order", arguments: { quoteId: body.quote.id } });
    assert.equal(order.isError, true, "an MCP agent cannot order a quote that waits for approval");
    assert.equal(structured(order).httpStatus, 409);
  });

  it("stops a blocked attempt, as the API does", async () => {
    // The hotel is nut-free; this soya product may contain nuts.
    const result = await client.callTool({ name: "create_quote", arguments: { lines: [{ productId: "460005", amount: 2, unit: "package" }] } });
    assert.equal(result.isError, true);
    assert.equal(structured(result).httpStatus, 422);
  });

  it("offers the purchasing guide and the agent's own policy as resources, and a prompt for quoting a need", async () => {
    const { resources } = await client.listResources();
    assert.deepEqual(resources.map((resource) => resource.uri).sort(), ["tta://openapi", "tta://policy", "tta://purchasing-guide"]);
    const policy = await client.readResource({ uri: "tta://policy" });
    const policies = JSON.parse((policy.contents[0] as { text: string }).text).policies;
    assert.deepEqual(policies.map((item: { agentId: string }) => item.agentId), ["demo-agent"], "an agent sees only its own policy");
    const prompt = await client.getPrompt({ name: "quote-a-need", arguments: { need: "1,000 litres of lactose-free milk", deliverBy: "2026-11-16" } });
    assert.match((prompt.messages[0]!.content as { text: string }).text, /1,000 litres of lactose-free milk, delivered by 2026-11-16/);
  });

  it("records every call in the audit history the buyer reads", async () => {
    const { body } = await server.request("GET", "/api/audit", { token: BUYER });
    assert.ok(body.entries.some((entry: { action: string; actor: { id: string } }) => entry.action === "quote.blocked" && entry.actor.id === "demo-agent"));
  });

  it("refuses a missing token, an unknown one, and a buyer's", async () => {
    const post = (headers: Record<string, string>) =>
      fetch(`${server.baseUrl}/api/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ Authorization: "Bearer not-a-token" })).status, 401);
    assert.equal((await post({ Authorization: `Bearer ${BUYER}` })).status, 403);
    assert.equal((await fetch(`${server.baseUrl}/api/mcp`)).status, 405);
  });
});
