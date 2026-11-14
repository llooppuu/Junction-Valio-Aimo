import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { riskLevel, supplierReliability } from "../src/services/reliability.js";
import type { CatalogEntry } from "../src/data/catalog.js";
import { startTestServer, type TestServer } from "./helpers.js";

describe("delivery reliability from Valio Aimo's history", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it("sets the risk level from the share delivered as ordered", () => {
    assert.equal(riskLevel(1), "low");
    assert.equal(riskLevel(0.95), "low");
    assert.equal(riskLevel(0.9), "moderate");
    assert.equal(riskLevel(0.84), "high");
  });

  it("averages a supplier's products that have a record, and names its weakest product", () => {
    const entry = (id: string, supplier: string, deliveryReliability?: number) =>
      ({ id, name: `Product ${id}`, supplier, ...(deliveryReliability !== undefined ? { deliveryReliability } : {}) }) as CatalogEntry;
    const [summary] = supplierReliability([entry("1", "A", 1), entry("2", "A", 0.8), entry("3", "A")]);
    assert.deepEqual(summary, {
      supplier: "A",
      products: 2,
      reliability: 0.9,
      lowest: { productId: "2", name: "Product 2", reliability: 0.8 },
      riskLevel: "moderate",
      flagged: true,
    });
  });

  it("lists suppliers with the most products on record first, with the formula", async () => {
    const { status, body } = await server.request("GET", "/api/suppliers");
    assert.equal(status, 200);
    assert.match(body.formula, /Share of ordered quantities delivered as ordered, from Valio Aimo's delivery history/);
    const valio = body.suppliers[0];
    assert.equal(valio.supplier, "VALIO OY TUORE");
    assert.equal(valio.riskLevel, "low");
    assert.ok(body.suppliers.every((supplier: { products: number }, index: number, all: { products: number }[]) => index === 0 || all[index - 1]!.products >= supplier.products));
    assert.ok(body.suppliers.some((supplier: { supplier: string; flagged: boolean }) => supplier.supplier === "KALAVAPRIIKKI OY TUORE" && supplier.flagged));
  });

  it("puts each product's own figure on it, and ranks products without one last", async () => {
    const { body } = await server.request("GET", "/api/products/462150");
    assert.equal(body.product.deliveryReliability, 0.962);
    const offers = (await server.request("GET", "/api/offers?category=plant-based&rankBy=reliability")).body.offers;
    assert.equal(offers[0].product.deliveryReliability, 1);
    assert.match(offers[0].reason, /^Most reliable delivery: 100% of ordered quantities delivered as ordered\./);
    const known = offers.filter((offer: { product: { deliveryReliability?: number } }) => offer.product.deliveryReliability !== undefined).length;
    assert.ok(offers.slice(known).every((offer: { product: { deliveryReliability?: number } }) => offer.product.deliveryReliability === undefined));
  });
});
