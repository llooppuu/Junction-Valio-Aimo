import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

const SCHOOL = "demo-school-agent-token";
const WHOLESALER = "demo-wholesaler-token";

describe("GET /api/wholesaler/activity", () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(() => server.close());

  it("is only for the wholesaler, and refusing a buyer is recorded", async () => {
    assert.equal((await server.request("GET", "/api/wholesaler/activity")).status, 401);
    assert.equal((await server.request("GET", "/api/wholesaler/activity", { token: BUYER })).status, 403);
    assert.equal((await server.request("GET", "/api/wholesaler/activity", { token: AGENT })).status, 403);
    const { body } = await server.request("GET", "/api/wholesaler/activity", { token: WHOLESALER });
    assert.equal(body.attention.filter((entry: { action: string }) => entry.action === "access.denied").length, 2);
  });

  it("shows every agent's activity across both buyers, what is waiting, and what was refused or blocked", async () => {
    const quote = (token: string, lines: unknown) => server.request("POST", "/api/quotes", { token, body: { lines } });
    // The hotel: one quote within its limit and ordered, one over it and waiting.
    const small = await quote(AGENT, [{ productId: "464306", quantity: { amount: 100, unit: "litre" } }]);
    await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: small.body.quote.id } });
    await quote(AGENT, [{ productId: "464306", quantity: { amount: 1500, unit: "litre" } }]);
    // The school: a blocked allergen, and an attempt to approve its own quote.
    await quote(SCHOOL, [{ productId: "464306", quantity: { amount: 60, unit: "litre" } }]);
    await server.request("POST", "/api/quotes/Q-0002/decision", { token: SCHOOL, body: { decision: "approve" } });

    const { status, body } = await server.request("GET", "/api/wholesaler/activity", { token: WHOLESALER });
    assert.equal(status, 200);
    const hotel = body.agents.find((agent: { agentId: string }) => agent.agentId === "demo-agent");
    const school = body.agents.find((agent: { agentId: string }) => agent.agentId === "school-agent");
    assert.deepEqual(
      { quotes: hotel.quotes, withinLimit: hotel.withinLimit, waiting: hotel.waitingForApproval, orders: hotel.orders, value: hotel.orderValueEurCents },
      { quotes: 2, withinLimit: 1, waiting: 1, orders: 1, value: 10100 },
    );
    assert.equal(hotel.buyerName, "Hotel chain");
    assert.deepEqual({ blocked: school.blocked, denied: school.accessDenied, quotes: school.quotes }, { blocked: 1, denied: 1, quotes: 0 });

    assert.deepEqual(body.waiting.map((item: { quoteId: string; buyerName: string }) => `${item.quoteId} ${item.buyerName}`), ["Q-0002 Hotel chain"]);
    const attention = body.attention.map((entry: { action: string; buyerName: string | null }) => `${entry.action} ${entry.buyerName}`);
    assert.deepEqual(attention, ["access.denied School kitchen", "quote.blocked School kitchen"]);
    assert.equal(body.entries.length, 7);
  });

  it("can read every buyer's policy, but cannot change anything", async () => {
    const policies = await server.request("GET", "/api/policy", { token: WHOLESALER });
    assert.deepEqual(policies.body.policies.map((policy: { buyerName: string }) => policy.buyerName), ["Hotel chain", "School kitchen"]);
    const order = await server.request("POST", "/api/orders", { token: WHOLESALER, body: { quoteId: "Q-0001" } });
    assert.equal(order.status, 403);
  });
});
