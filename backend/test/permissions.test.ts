import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AGENT, BUYER, startTestServer, testStore } from "./helpers.js";

// Arki Eila lactose-free milk at Valio Aimo's €1.01 per litre: 1,000 L totals exactly €1,010.00.
const MILK_1000_L = { lines: [{ productId: "464306", quantity: { amount: 1000, unit: "litre" } }] };

/** Runs a test against a fresh server, optionally with a custom spending limit. */
async function withServer(spendingLimitEurCents: number | undefined, test: (server: Awaited<ReturnType<typeof startTestServer>>) => Promise<void>) {
  const server = await startTestServer({ store: testStore(spendingLimitEurCents === undefined ? {} : { spendingLimitEurCents }) });
  try {
    await test(server);
  } finally {
    await server.close();
  }
}

describe("purchasing permissions", () => {
  it("lets the agent order €1,010.00 within its €1,400.00 limit", () =>
    withServer(undefined, async (server) => {
      const { body } = await server.request("POST", "/api/quotes", { token: AGENT, body: MILK_1000_L });
      assert.equal(body.quote.status, "within_limit");
      assert.equal(body.quote.permission.decision, "within_limit");
      assert.equal(body.quote.permission.limitEurCents, 140000);
      assert.equal(body.quote.permission.reason, "The total of €1,010.00 is within the agent's limit of €1,400.00, so the agent may order it.");
    }));

  it("sends €1,515.00 to the buyer, naming the limit once", () =>
    withServer(undefined, async (server) => {
      const { body } = await server.request("POST", "/api/quotes", {
        token: AGENT,
        body: { lines: [{ productId: "464306", quantity: { amount: 1500, unit: "litre" } }] },
      });
      assert.equal(body.quote.totalEurCents, 151500);
      assert.equal(body.quote.status, "needs_approval");
      assert.equal(body.quote.permission.reason, "The total of €1,515.00 exceeds the agent's limit of €1,400.00, so the buyer must approve it.");
    }));

  for (const [label, limit, expected] of [
    ["just below the limit", 101001, "within_limit"],
    ["exactly at the limit", 101000, "within_limit"],
    ["just above the limit", 100999, "needs_approval"],
  ] as const) {
    it(`treats a total ${label} as ${expected}`, () =>
      withServer(limit, async (server) => {
        const { body } = await server.request("POST", "/api/quotes", { token: AGENT, body: MILK_1000_L });
        assert.equal(body.quote.totalEurCents, 101000);
        assert.equal(body.quote.status, expected);
      }));
  }

  it("does not let a client set the limit in a quote request", () =>
    withServer(undefined, async (server) => {
      const { status, body } = await server.request("POST", "/api/quotes", { token: AGENT, body: { ...MILK_1000_L, spendingLimitEurCents: 99999999 } });
      assert.equal(status, 400);
      assert.match(body.details[0].message, /spendingLimitEurCents/);
    }));

  it("offers no endpoint that changes the policy", () =>
    withServer(undefined, async (server) => {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const { status } = await server.request(method, "/api/policy", { token: BUYER, body: { spendingLimitEurCents: 99999999 } });
        assert.equal(status, 404, method);
      }
      const { body } = await server.request("GET", "/api/policy", { token: AGENT });
      assert.equal(body.policies[0].spendingLimitEurCents, 140000);
    }));

  it("shows the agent only its own policy and requires credentials", () =>
    withServer(undefined, async (server) => {
      const agent = await server.request("GET", "/api/policy", { token: AGENT });
      assert.deepEqual(agent.body.policies.map((policy: { agentId: string }) => policy.agentId), ["demo-agent"]);
      assert.equal((await server.request("GET", "/api/policy")).status, 401);
    }));

  it("treats a quote the buyer creates as approved", () =>
    withServer(undefined, async (server) => {
      const { body } = await server.request("POST", "/api/quotes", { token: BUYER, body: MILK_1000_L });
      assert.equal(body.quote.status, "approved");
      assert.equal(body.quote.permission.decision, "created_by_buyer");
      assert.equal(body.quote.permission.limitEurCents, null);
    }));

  it("refuses an agent with no policy and leaves no quote behind", async () => {
    const store = testStore();
    store.policies.clear();
    const server = await startTestServer({ store });
    try {
      const { status } = await server.request("POST", "/api/quotes", { token: AGENT, body: MILK_1000_L });
      assert.equal(status, 403);
      assert.equal(store.quotes.size, 0);
      assert.equal(store.nextQuoteNumber, 1);
    } finally {
      await server.close();
    }
  });
});
