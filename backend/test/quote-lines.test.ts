import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AGENT, startTestServer, type TestServer } from "./helpers.js";

/** How a quote's lines are formed: one line per product however it is named, and whole lots. */
describe("quote lines", () => {
  let server: TestServer;
  let offerToken: string;
  before(async () => {
    server = await startTestServer();
    offerToken = (await server.request("GET", "/api/products/464306")).body.product.offer.token;
  });
  after(() => server.close());

  const quote = (lines: object[]) => server.request("POST", "/api/quotes", { token: AGENT, body: { lines } });

  it("refuses the same product twice through repeated signed offers, which could otherwise oversell stock", async () => {
    const twice = await quote([
      { offerToken, quantity: { amount: 6, unit: "package" } },
      { offerToken, quantity: { amount: 6, unit: "package" } },
    ]);
    assert.equal(twice.status, 422);
    assert.match(twice.body.error, /464306 appears more than once/);
  });

  it("refuses a product named once by ID and once by its signed offer", async () => {
    const mixed = await quote([
      { productId: "464306", quantity: { amount: 6, unit: "package" } },
      { offerToken, quantity: { amount: 6, unit: "package" } },
    ]);
    assert.equal(mixed.status, 422);
    assert.match(mixed.body.error, /appears more than once/);
  });

  it("rounds a package request up to the product's lot size, and shows both what was asked and what is ordered", async () => {
    // Valio Aimo sells this trout only in lots of ten packages.
    const one = await quote([{ productId: "462016", quantity: { amount: 1, unit: "package" } }]);
    assert.equal(one.status, 201, JSON.stringify(one.body));
    const [line] = one.body.quote.lines;
    assert.equal(line.lotSize, 10);
    assert.equal(line.packages, 10);
    assert.deepEqual(line.requested, { amount: 1, unit: "package" });
    assert.equal(line.lineTotalEurCents, 10 * line.pricePerPackageEurCents);
  });
});
