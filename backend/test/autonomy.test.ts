import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AGENT, BUYER, startTestServer, type TestServer, testStore } from "./helpers.js";

/**
 * Earned autonomy: the agent starts supervised and earns the right to order
 * alone per product category from the buyer's approvals. A rejection or a
 * blocked attempt takes it away again, and only the buyer can grant or revoke.
 */

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start() {
  server = await startTestServer({ store: testStore({ autonomy: "earned" }) });
  return server;
}

const MILK = "464306"; // Lactose-free milk 1 l, €1.01: the brief's product.
const EMMENTAL = "476660"; // Cheese, which the hotel's track record has earned.

function quote(productId: string, quantity: { amount: number; unit: string }) {
  return server!.request("POST", "/api/quotes", { token: AGENT, body: { lines: [{ productId, quantity }] } });
}
const litres = (amount: number) => ({ amount, unit: "litre" });
const check = (body: any) => body.quote.permission.checks.find((item: { rule: string }) => item.rule === "earned_autonomy");

async function milkStatus() {
  const { body } = await server!.request("GET", "/api/autonomy", { token: BUYER });
  const hotel = body.agents.find((agent: { agentId: string }) => agent.agentId === "demo-agent");
  return hotel.categories.find((category: { category: string }) => category.category === "milk");
}

describe("earned autonomy", () => {
  it("sends the brief's milk request to the buyer while milk is not yet earned, and says why", async () => {
    await start();
    const { body } = await quote(MILK, litres(1000));
    assert.equal(body.quote.status, "needs_approval");
    assert.equal(check(body).outcome, "needs_approval");
    assert.match(check(body).detail, /has not yet earned autonomy in milk \(1 more approval in a row needed\)/);
    const milk = await milkStatus();
    assert.deepEqual([milk.status, milk.approvalsInRow, milk.approvalsToEarn], ["supervised", 2, 3]);
  });

  it("lets the agent order alone where its track record has earned it", async () => {
    await start();
    const { body } = await quote(EMMENTAL, { amount: 2, unit: "package" });
    assert.equal(body.quote.status, "within_limit");
    assert.equal(check(body).outcome, "passed");
    assert.match(check(body).detail, /earned autonomy in cheese up to €96\.00/);
  });

  it("earns milk with the buyer's next approval, up to the largest total approved", async () => {
    await start();
    const first = await quote(MILK, litres(1000));
    const total = first.body.quote.totalEurCents;
    const decision = await server!.request("POST", `/api/quotes/${first.body.quote.id}/decision`, { token: BUYER, body: { decision: "approve" } });
    assert.equal(decision.status, 200);

    const milk = await milkStatus();
    assert.deepEqual([milk.status, milk.earnedBy, milk.capEurCents], ["earned", "approvals", total]);
    assert.match(milk.explanation, /approved 3 milk quotes in a row/);

    // The same order again: now the agent may place it alone.
    const second = await quote(MILK, litres(1000));
    assert.equal(second.body.quote.status, "within_limit");
    assert.equal(check(second.body).outcome, "passed");

    // The change is in the audit history.
    const audit = await server!.request("GET", "/api/audit", { token: BUYER });
    assert.ok(audit.body.entries.some((entry: { action: string; summary: string }) => entry.action === "autonomy.changed" && /earned autonomy in milk/.test(entry.summary)));
  });

  it("still asks the buyer for more than the agent has earned", async () => {
    await start();
    const first = await quote(MILK, litres(1000));
    await server!.request("POST", `/api/quotes/${first.body.quote.id}/decision`, { token: BUYER, body: { decision: "approve" } });
    const bigger = await quote(MILK, litres(1300));
    assert.equal(bigger.body.quote.status, "needs_approval");
    assert.match(check(bigger.body).detail, /of milk is above the €1,010\.00 the agent has earned/);
  });

  it("loses autonomy on a rejection: trust is lost faster than it is earned", async () => {
    await start();
    const first = await quote(MILK, litres(1000));
    await server!.request("POST", `/api/quotes/${first.body.quote.id}/decision`, { token: BUYER, body: { decision: "approve" } });
    const bigger = await quote(MILK, litres(1300));
    await server!.request("POST", `/api/quotes/${bigger.body.quote.id}/decision`, { token: BUYER, body: { decision: "reject", note: "Too much milk" } });

    const milk = await milkStatus();
    assert.deepEqual([milk.status, milk.approvalsInRow, milk.totals.rejections], ["supervised", 0, 1]);
    assert.match(milk.lastReset.reason, /Too much milk/);
    const again = await quote(MILK, litres(1000));
    assert.equal(again.body.quote.status, "needs_approval");
  });

  it("loses autonomy when the rules block an attempt", async () => {
    await start();
    // The hotel is nut-free; this soya product may contain nuts. Plant-based was earned before the attempt.
    const blocked = await quote("460005", { amount: 2, unit: "package" });
    assert.equal(blocked.status, 422);
    const { body } = await server!.request("GET", "/api/autonomy", { token: BUYER });
    const plant = body.agents[0].categories.find((category: { category: string }) => category.category === "plant-based");
    assert.deepEqual([plant.status, plant.totals.refusals], ["supervised", 1]);
    assert.match(plant.lastReset.reason, /Blocked by the allergen rule/);
  });

  it("lets only the buyer grant or revoke, and never above the policy limit", async () => {
    await start();
    const path = "/api/autonomy/demo-agent/categories/milk";
    const byAgent = await server!.request("POST", `${path}/grant`, { token: AGENT, body: {} });
    assert.equal(byAgent.status, 403);
    const tooMuch = await server!.request("POST", `${path}/grant`, { token: BUYER, body: { capEurCents: 200_000 } });
    assert.equal(tooMuch.status, 422);

    const granted = await server!.request("POST", `${path}/grant`, { token: BUYER, body: { capEurCents: 120_000 } });
    assert.deepEqual([granted.body.category.status, granted.body.category.earnedBy, granted.body.category.capEurCents], ["earned", "buyer", 120_000]);
    assert.equal((await quote(MILK, litres(1000))).body.quote.status, "within_limit");

    const revoked = await server!.request("POST", `${path}/revoke`, { token: BUYER, body: { reason: "Seasonal menu change" } });
    assert.equal(revoked.body.category.status, "supervised");
    assert.equal((await quote(MILK, litres(1000))).body.quote.status, "needs_approval");

    const unknown = await server!.request("POST", "/api/autonomy/demo-agent/categories/spaceships/grant", { token: BUYER, body: {} });
    assert.equal(unknown.status, 404);
  });

  it("shows an agent only its own record", async () => {
    await start();
    const { body } = await server!.request("GET", "/api/autonomy", { token: AGENT });
    assert.deepEqual(body.agents.map((agent: { agentId: string }) => agent.agentId), ["demo-agent"]);
    assert.equal(body.agents[0].mode, "earned");
  });
});
