import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Store } from "../src/store.js";
import { AGENT, BUYER, recordedValio, startTestServer, type TestServer, testStore } from "./helpers.js";

const actions = (entries: { action: string }[]) => entries.map((entry) => entry.action);

describe("audit history for the full demo story", () => {
  let server: TestServer;
  let store: Store;

  before(async () => {
    const valio = recordedValio();
    store = testStore({ valio });
    server = await startTestServer({ store });
    const call = (method: string, path: string, token: string, body?: unknown) =>
      server.request(method, path, { token, body });

    await call("POST", "/api/quotes", AGENT, {
      lines: [{ productId: "470863", quantity: { amount: 1000, unit: "litre" } }],
      requirements: { attributes: ["milk-free"], deliverBy: "2026-11-16" },
    });
    // Valio Aimo's count of Oatly Oat Drink Semi falls from 1,414 to 600.
    valio.setAvailability("470863", { availableAmount: 600 });
    await call("POST", "/api/quotes/Q-0001/recheck", AGENT);
    await call("POST", "/api/quotes", AGENT, {
      replacesQuoteId: "Q-0001",
      lines: [
        { productId: "470863", quantity: { amount: 600, unit: "package" } },
        { productId: "461174", quantity: { amount: 400, unit: "litre" } },
      ],
    });
    await call("POST", "/api/orders", AGENT, { quoteId: "Q-0002" });
    await call("POST", "/api/quotes/Q-0002/decision", BUYER, { decision: "approve", note: "Weekend event" });
    await call("POST", "/api/orders", AGENT, { quoteId: "Q-0002" });
    await call("POST", "/api/orders", AGENT, { quoteId: "Q-0002" });
  });
  after(() => server.close());

  it("tells the original quote's story in order", async () => {
    const { status, body } = await server.request("GET", "/api/quotes/Q-0001/audit", { token: AGENT });
    assert.equal(status, 200);
    assert.deepEqual(actions(body.entries), [
      "quote.created",
      "permission.checked",
      "quote.out_of_date",
      "quote.replaced",
    ]);
    assert.equal(body.entries[2].reason, "400 L missing from OATLY EMEA AB (600 of 1000 packages left)");
  });

  it("tells the replacement's story, including the refusal, approval, order, and retry", async () => {
    const { body } = await server.request("GET", "/api/quotes/Q-0002/audit", { token: BUYER });
    assert.deepEqual(actions(body.entries), [
      "quote.created",
      "quote.replaced",
      "permission.checked",
      "order.refused",
      "decision.approved",
      "order.placed",
      "order.replayed",
    ]);

    const byAction = Object.fromEntries(body.entries.map((entry: { action: string }) => [entry.action, entry]));
    assert.match(byAction["permission.checked"].reason, /€1,846.59 exceeds the agent's limit of €1,400.00/);
    assert.match(byAction["order.refused"].reason, /waiting for the buyer's approval/);
    assert.equal(byAction["decision.approved"].actor.name, "Head chef");
    assert.equal(byAction["decision.approved"].reason, "Weekend event");
    assert.equal(byAction["order.placed"].orderId, "O-0001");
    assert.match(byAction["order.placed"].reason, /approved by the buyer/);
    assert.equal(byAction["order.placed"].actor.role, "agent");
  });

  it("gives every entry an ID, timestamp, actor, and readable summary", () => {
    for (const entry of store.audit) {
      assert.match(entry.id, /^A-\d{5}$/);
      assert.ok(!Number.isNaN(Date.parse(entry.at)));
      assert.ok(entry.actor.id && entry.actor.role && entry.actor.name);
      assert.ok(entry.summary.endsWith("."), entry.summary);
    }
  });

  it("lists the whole history newest first for the buyer only", async () => {
    const { body } = await server.request("GET", "/api/audit", { token: BUYER });
    assert.equal(body.total, store.audit.length);
    assert.equal(body.entries[0].action, "order.replayed");
    assert.ok(actions(body.entries).includes("quote.out_of_date"));
    const limited = await server.request("GET", "/api/audit?limit=2", { token: BUYER });
    assert.equal(limited.body.entries.length, 2);
    assert.equal((await server.request("GET", "/api/audit", { token: AGENT })).status, 403);
  });

  it("cannot be edited through the API or in memory", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await server.request(method, "/api/audit", { token: BUYER, body: {} })).status, 404, method);
    }
    assert.equal((await server.request("DELETE", "/api/audit/A-00001", { token: BUYER })).status, 404);
    assert.throws(() => {
      (store.audit[0] as { summary: string }).summary = "rewritten";
    }, TypeError);
    assert.throws(() => {
      (store.audit[0]!.actor as { name: string }).name = "someone else";
    }, TypeError);
  });

  it("returns 404 for the history of an unknown quote", async () => {
    assert.equal((await server.request("GET", "/api/quotes/Q-9999/audit", { token: AGENT })).status, 404);
  });
});

describe("audited refusals", () => {
  it("records a refused quote with its reason", async () => {
    const store = testStore();
    const server = await startTestServer({ store });
    try {
      await server.request("POST", "/api/quotes", {
        token: AGENT,
        body: { lines: [{ productId: "470863", quantity: { amount: 1500, unit: "litre" } }] },
      });
      const [entry] = store.audit;
      assert.equal(entry?.action, "quote.refused");
      assert.match(entry?.reason ?? "", /1500 packages needed, 1414 available/);
      assert.equal(entry?.actor.role, "agent");
    } finally {
      await server.close();
    }
  });
});
