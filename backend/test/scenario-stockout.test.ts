import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { executeTool } from "../src/agent/tools.js";
import { SCENARIO_PRODUCTS as P } from "../src/data/recipes.js";
import type { RecordedValio } from "../src/services/valio.js";
import { AGENT, BUYER, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

const SCHOOL = "demo-school-agent-token";
const EGGS = P.eggs; // Kieku Barn Eggs L180, 12.3 kg
const SMALL_EGGS = "467464"; // Kieku Barn eggs S90, 4.32 kg

describe("scenario: supplier stock-out before the weekly delivery", () => {
  let server: TestServer;
  let valio: RecordedValio;
  beforeEach(async () => {
    valio = recordedValio();
    server = await startTestServer({ store: testStore({ valio }) });
  });
  afterEach(() => server.close());

  const alerts = async (token = BUYER, status?: string) => (await server.request("GET", `/api/alerts${status ? `?status=${status}` : ""}`, { token })).body.alerts;
  const audit = async () => (await server.request("GET", "/api/audit?limit=80", { token: BUYER })).body.entries;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forProduct = (list: any[], productId: string): any[] => list.filter((alert) => alert.productId === productId);

  it("notices what Valio Aimo cannot deliver for the next planned order, without being asked", async () => {
    const open = await alerts();
    // Neither kitchen's usual oat cooking cream can be delivered on any date.
    const hotel = open.find((alert: { agentId: string; productId: string }) => alert.agentId === "demo-agent" && alert.productId === P.oatCream);
    assert.equal(hotel.problem, "Valio Aimo cannot deliver it on any date");
    assert.deepEqual(hotel.affects, {
      dishes: [{ dish: "Roasted beetroot soup with oat cream", role: "finishing cream" }],
      plannedOrder: { name: "Weekly kitchen order", deliveryDate: "2026-11-16", packages: 2 },
    });
    // A cooking cream is replaced by a cooking cream, delivered in time for Monday.
    assert.deepEqual(
      (({ productId, deliveryDate }) => ({ productId, deliveryDate }))(hotel.proposals[0].substitute),
      { productId: "473956", deliveryDate: "2026-11-16" },
    );
    const school = open.find((alert: { agentId: string; productId: string }) => alert.productId === P.oatCookingSchool);
    assert.equal(school.agentId, "school-agent");
    assert.equal(school.proposals[0].substitute.productId, "460697");

    // The alerts and proposals are in the audit history, by each kitchen's agent. Nothing was ordered.
    const entries = await audit();
    const alertEntry = entries.find((entry: { action: string; actor: { id: string } }) => entry.action === "stock.alert" && entry.actor.id === "demo-agent");
    assert.match(alertEntry.reason, /without a request/);
    const proposed = entries.find((entry: { action: string; actor: { id: string } }) => entry.action === "substitute.proposed" && entry.actor.id === "demo-agent");
    assert.match(proposed.reason, /Proposed only, nothing ordered/);
    assert.deepEqual((await server.request("GET", "/api/quotes", { token: BUYER })).body.quotes, []);
  });

  it("proposes a substitute for each kitchen's recipe when eggs run out", async () => {
    valio.setAvailability(EGGS, { availableAmount: 0 });
    const eggs = forProduct(await alerts(BUYER, "open"), EGGS);
    assert.deepEqual(eggs.map((alert: any) => alert.agentId).sort(), ["demo-agent", "school-agent"]);
    const hotel = eggs.find((alert: any) => alert.agentId === "demo-agent");
    assert.equal(hotel.problem, "none available for 2026-11-16");
    assert.deepEqual(hotel.affects.dishes, [{ dish: "Garden salad with cherry tomatoes and Emmental", role: "salad topping" }]);
    assert.equal(hotel.proposals[0].substitute.productId, SMALL_EGGS);
    const school = eggs.find((alert: any) => alert.agentId === "school-agent");
    assert.equal(school.proposals[0].role, "binding");
  });

  it("checks the next planned order, not only a stock-out", async () => {
    // The hotel's weekly order needs two cases and the school's one, so one case left only worries the hotel.
    valio.setAvailability(EGGS, { availableAmount: 1 });
    const eggs = forProduct(await alerts(BUYER, "open"), EGGS);
    assert.deepEqual(eggs.map((alert: any) => alert.agentId), ["demo-agent"]);
    assert.equal(eggs[0].problem, "only 1 package left, 2 on the next planned order");
  });

  it("raises each alert once and resolves it when Valio Aimo has stock again", async () => {
    valio.setAvailability(EGGS, { availableAmount: 0 });
    const first = forProduct(await alerts(BUYER, "open"), EGGS).length;
    assert.equal(first, 2);
    assert.equal(forProduct(await alerts(BUYER, "open"), EGGS).length, 2, "asking again raises nothing new");
    valio.setAvailability(EGGS, { availableAmount: 9_999_999_999 });
    assert.equal(forProduct(await alerts(BUYER, "open"), EGGS).length, 0);
    assert.equal(forProduct(await alerts(BUYER, "resolved"), EGGS).length, 2);
    assert.equal((await audit()).filter((entry: { action: string }) => entry.action === "stock.alert_resolved").length, 2);
  });

  it("stays quiet about products no kitchen depends on", async () => {
    const before = (await alerts()).length;
    valio.setAvailability("470863", { availableAmount: 0 });
    assert.equal((await alerts()).length, before);
  });

  it("shows an agent only its own kitchen's alerts, through the API and its tool", async () => {
    assert.ok((await alerts(SCHOOL)).every((alert: { agentId: string }) => alert.agentId === "school-agent"));
    assert.ok((await alerts(AGENT)).every((alert: { agentId: string }) => alert.agentId === "demo-agent"));
    const execution = await executeTool({ baseUrl: `${server.baseUrl}/api`, token: AGENT }, "get_alerts", "{}");
    assert.equal(execution.httpStatus, 200);
    assert.match(execution.summary, /^AL-\d{4}: Oddlygood® Cooking 1 l UHT Valio Aimo cannot deliver it on any date$/);
  });

  it("notices when another kitchen's order uses up the stock", async () => {
    // Valio Aimo has three cases; the hotel orders all three, which leaves nothing for the school.
    valio.setAvailability(EGGS, { availableAmount: 3 });
    const quote = await server.request("POST", "/api/quotes", { token: AGENT, body: { lines: [{ productId: EGGS, quantity: { amount: 3, unit: "package" } }] } });
    assert.equal(quote.body.quote.status, "within_limit");
    assert.equal((await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: quote.body.quote.id } })).status, 201);
    assert.deepEqual(forProduct(await alerts(SCHOOL, "open"), EGGS).map((alert: any) => alert.agentId), ["school-agent"]);
  });

  it("rejects an unknown status filter", async () => {
    assert.equal((await server.request("GET", "/api/alerts?status=maybe", { token: BUYER })).status, 400);
  });
});
