import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

const litres = (amount: number) => ({ amount, unit: "litre" });

describe("POST /api/quotes", () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(() => server.close());

  const quote = (lines: unknown, token = AGENT, requirements?: unknown) =>
    server.request("POST", "/api/quotes", { token, body: { lines, ...(requirements ? { requirements } : {}) } });

  it("quotes 1,000 L of lactose-free milk at Valio Aimo's fixed price, with its delivery terms", async () => {
    const { status, body } = await quote([{ productId: "464306", quantity: litres(1000) }]);
    assert.equal(status, 201);
    assert.match(body.quote.id, /^Q-\d{4}$/);
    const [line] = body.quote.lines;
    assert.equal(line.packages, 1000);
    assert.deepEqual(line.quantity, { amount: 1000, unit: "litre" });
    assert.equal(line.pricePerPackageEurCents, 101);
    assert.equal(line.salesUnit, "ST");
    assert.equal(line.vatRatePercent, 13.5);
    assert.equal(line.customerPrice, true);
    assert.equal(line.orderCutoff, "2026-11-15T17:00:00+0200");
    assert.equal(line.stockStatus, "plenty");
    assert.equal(body.quote.totalEurCents, 101000);
    assert.equal(body.quote.deliveryDate, "2026-11-16");
    assert.equal(body.quote.createdBy.role, "agent");
  });

  it("rounds 100 L up to whole cases of 18 × 2.5 dl", async () => {
    const { body } = await quote([{ productId: "461174", quantity: litres(100) }]);
    const [line] = body.quote.lines;
    assert.equal(line.packages, 23);
    assert.deepEqual(line.quantity, { amount: 103.5, unit: "litre" });
    assert.equal(body.quote.totalEurCents, 23 * 1131);
  });

  it("accepts whole packages and several lines", async () => {
    const { status, body } = await quote([
      { productId: "464306", quantity: { amount: 60, unit: "package" } },
      { productId: "464411", quantity: { amount: 25, unit: "kilogram" } },
    ]);
    assert.equal(status, 201);
    assert.equal(body.quote.lines[1].packages, 50);
    assert.equal(body.quote.totalEurCents, 60 * 101 + 50 * 330);
  });

  it("refuses a product that breaks an allergen or label requirement, with the reason", async () => {
    const milk = await quote([{ productId: "464306", quantity: litres(100) }], AGENT, { excludeAllergens: ["milk"] });
    assert.equal(milk.status, 422);
    assert.match(milk.body.error, /contains milk/);

    const salmon = await quote([{ productId: "462150", quantity: { amount: 5, unit: "kilogram" } }], AGENT, { labels: ["msc"] });
    assert.equal(salmon.status, 422);
    assert.match(salmon.body.error, /no msc label/);

    const rice = await quote([{ productId: "473424", quantity: litres(24) }], AGENT, { excludeAllergens: ["milk", "gluten", "soy"] });
    assert.equal(rice.status, 201);
    assert.deepEqual(rice.body.quote.requirements.excludeAllergens, ["milk", "gluten", "soy"]);
  });

  it("refuses more than the stock Valio Aimo counts", async () => {
    const { status, body } = await quote([{ productId: "470863", quantity: litres(1500) }]);
    assert.equal(status, 409);
    assert.match(body.error, /1500 packages needed, 1414 available \(1,414 L\)/);
    assert.equal(body.availablePackages, 1414);
  });

  it("refuses a product Valio Aimo cannot deliver, or cannot deliver in time, with the reason", async () => {
    const none = await quote([{ productId: "469094", quantity: litres(10) }]);
    assert.equal(none.status, 409);
    assert.equal(none.body.error, "Oddlygood® Cooking 1 l UHT (469094) cannot be quoted: Valio Aimo cannot deliver it on any date.");
    const late = await quote([{ productId: "463038", quantity: litres(1000) }]);
    assert.equal(late.status, 409);
    assert.match(late.body.error, /the order cut-off for delivery on 2026-11-16 was Thursday 12 November at 15:00/);
  });

  it("can be read back by ID and listed", async () => {
    const created = await quote([{ productId: "463982", quantity: { amount: 1, unit: "package" } }]);
    const read = await server.request("GET", `/api/quotes/${created.body.quote.id}`, { token: BUYER });
    assert.deepEqual(read.body.quote, created.body.quote);
    const list = await server.request("GET", "/api/quotes", { token: AGENT });
    assert.equal(list.body.quotes.length, 1);
  });

  it("rejects a client-supplied price", async () => {
    const { status, body } = await quote([{ productId: "464306", quantity: litres(1000), pricePerPackageEurCents: 1 }]);
    assert.equal(status, 400);
    assert.match(body.details[0].message, /pricePerPackageEurCents/);
  });

  it("rejects an unknown product and a unit the product is not sold in", async () => {
    const unknown = await quote([{ productId: "caviar", quantity: { amount: 1, unit: "package" } }]);
    assert.equal(unknown.status, 422);
    assert.match(unknown.body.error, /Unknown product "caviar"/);
    const unit = await quote([{ productId: "464306", quantity: { amount: 5, unit: "kilogram" } }]);
    assert.equal(unit.status, 422);
    assert.match(unit.body.error, /sold by the litre/);
  });

  it("rejects fractional packages, duplicate products, and empty quotes", async () => {
    const fractional = await quote([{ productId: "463982", quantity: { amount: 1.5, unit: "package" } }]);
    assert.equal(fractional.status, 422);
    const duplicate = await quote([
      { productId: "463982", quantity: { amount: 1, unit: "package" } },
      { productId: "463982", quantity: { amount: 2, unit: "package" } },
    ]);
    assert.equal(duplicate.status, 400);
    assert.equal((await quote([])).status, 400);
  });

  it("rejects malformed JSON", async () => {
    const response = await fetch(`${server.baseUrl}/api/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AGENT}` },
      body: "{not json",
    });
    assert.equal(response.status, 400);
  });

  it("requires credentials", async () => {
    const line = [{ productId: "463982", quantity: { amount: 1, unit: "package" } }];
    assert.equal((await quote(line, "")).status, 401);
    assert.equal((await quote(line, "nope-nope-nope")).status, 401);
    assert.equal((await server.request("GET", "/api/quotes")).status, 401);
  });

  it("returns 404 for an unknown quote", async () => {
    const { status } = await server.request("GET", "/api/quotes/Q-9999", { token: AGENT });
    assert.equal(status, 404);
  });
});
