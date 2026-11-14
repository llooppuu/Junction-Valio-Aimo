import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { RecordedValio } from "../src/services/valio.js";
import { AGENT, BUYER, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

// Oatly Oat Drink Semi: Valio Aimo counts 1,414 one-litre cartons at €1.40, so 1,000 L is exactly the €1,400 limit.
const WITHIN_LIMIT = { lines: [{ productId: "470863", quantity: { amount: 1000, unit: "litre" } }] };
// Arki Eila at €1.01 per litre: 1,500 L is €1,515, over the limit.
const OVER_LIMIT = { lines: [{ productId: "464306", quantity: { amount: 1500, unit: "litre" } }] };

describe("POST /api/orders", () => {
  let server: TestServer;
  let valio: RecordedValio;
  beforeEach(async () => {
    valio = recordedValio();
    server = await startTestServer({ store: testStore({ valio }) });
  });
  afterEach(() => server.close());

  const quote = async (body: unknown) => (await server.request("POST", "/api/quotes", { token: AGENT, body })).body.quote;
  const order = (quoteId: string, token = AGENT) => server.request("POST", "/api/orders", { token, body: { quoteId } });
  const stockOf = async (productId: string) => (await server.request("GET", `/api/products/${productId}`)).body.product.availablePackages;

  it("places an order from a within-limit quote and reserves the stock", async () => {
    const { id } = await quote(WITHIN_LIMIT);
    const { status, body } = await order(id);
    assert.equal(status, 201);
    assert.equal(body.created, true);
    assert.match(body.order.id, /^O-\d{4}$/);
    assert.equal(body.order.quoteId, id);
    assert.equal(body.order.totalEurCents, 140000);
    assert.equal(body.order.placedBy.role, "agent");
    // The mock APIs take no orders, so the reservation comes off the stock Valio Aimo reports.
    assert.equal(await stockOf("470863"), 414);

    const read = await server.request("GET", `/api/quotes/${id}`, { token: BUYER });
    assert.equal(read.body.quote.status, "ordered");
    assert.equal(read.body.quote.orderId, body.order.id);
  });

  it("does not create a second order when the request is retried", async () => {
    const { id } = await quote(WITHIN_LIMIT);
    const first = await order(id);
    const retry = await order(id);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.created, false);
    assert.equal(retry.body.order.id, first.body.order.id);
    assert.equal(await stockOf("470863"), 414);
    const orders = await server.request("GET", "/api/orders", { token: BUYER });
    assert.equal(orders.body.orders.length, 1);
  });

  it("refuses a quote that needs approval, then accepts it once approved", async () => {
    const { id, status } = await quote(OVER_LIMIT);
    assert.equal(status, "needs_approval");
    const refused = await order(id);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /waiting for the buyer's approval/);

    await server.request("POST", `/api/quotes/${id}/decision`, { token: BUYER, body: { decision: "approve" } });
    const placed = await order(id);
    assert.equal(placed.status, 201);
    assert.equal(placed.body.order.totalEurCents, 151500);
  });

  it("refuses a rejected quote", async () => {
    const { id } = await quote(OVER_LIMIT);
    await server.request("POST", `/api/quotes/${id}/decision`, { token: BUYER, body: { decision: "reject" } });
    const { status, body } = await order(id);
    assert.equal(status, 409);
    assert.match(body.error, /was rejected/);
  });

  it("asks Valio Aimo again when ordering, and refuses if its stock has fallen", async () => {
    const { id } = await quote(WITHIN_LIMIT);
    valio.setAvailability("470863", { availableAmount: 600 });
    const { status, body } = await order(id);
    assert.equal(status, 409);
    assert.equal(body.shortfalls[0].missingQuantity.amount, 400);
    const read = await server.request("GET", `/api/quotes/${id}`, { token: BUYER });
    assert.equal(read.body.quote.status, "out_of_date");
    // A second attempt stays refused while the quote is out of date.
    const again = await order(id);
    assert.equal(again.status, 409);
    assert.equal(again.body.quoteStatus, "out_of_date");
  });

  it("refuses an order when Valio Aimo no longer delivers the product at all", async () => {
    const { id } = await quote(WITHIN_LIMIT);
    valio.setAvailability("470863", { scheduleLines: [] });
    const { status, body } = await order(id);
    assert.equal(status, 409);
    assert.equal(body.shortfalls[0].availablePackages, 0);
  });

  it("stops a second quote from ordering stock the first order already took", async () => {
    const first = await quote(WITHIN_LIMIT);
    const second = await quote(WITHIN_LIMIT);
    assert.equal((await order(first.id)).status, 201);
    assert.equal((await order(second.id)).status, 409);
  });

  it("validates the request", async () => {
    assert.equal((await order("Q-9999")).status, 404);
    assert.equal((await order("Q-0001", "")).status, 401);
    const extra = await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: "Q-0001", totalEurCents: 1 } });
    assert.equal(extra.status, 400);
    assert.equal((await server.request("GET", "/api/orders/O-9999", { token: AGENT })).status, 404);
  });
});
