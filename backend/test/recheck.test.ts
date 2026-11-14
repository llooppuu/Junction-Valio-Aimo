import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { RecordedValio } from "../src/services/valio.js";
import { AGENT, BUYER, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

describe("rechecking a quote against Valio Aimo, and starting over", () => {
  let server: TestServer;
  let valio: RecordedValio;
  beforeEach(async () => {
    valio = recordedValio();
    server = await startTestServer({ store: testStore({ valio }) });
  });
  afterEach(() => server.close());

  // 1,000 cartons of Oatly Oat Drink Semi, from the 1,414 Valio Aimo counts.
  const quoteOatly = async () => {
    const { body } = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: [{ productId: "470863", quantity: { amount: 1000, unit: "litre" } }] },
    });
    return body.quote.id as string;
  };
  const recheck = (id: string, token = AGENT) => server.request("POST", `/api/quotes/${id}/recheck`, { token });

  it("leaves a quote unchanged while Valio Aimo's stock can still fill it", async () => {
    const id = await quoteOatly();
    const { status, body } = await recheck(id);
    assert.equal(status, 200);
    assert.equal(body.changed, false);
    assert.deepEqual(body.shortfalls, []);
    assert.equal(body.quote.status, "within_limit");
  });

  it("marks the quote out of date with a 400 L shortfall when Valio Aimo's stock falls to 600", async () => {
    const id = await quoteOatly();
    valio.setAvailability("470863", { availableAmount: 600 });
    const { body } = await recheck(id);
    assert.equal(body.changed, true);
    assert.equal(body.quote.status, "out_of_date");
    assert.deepEqual(body.shortfalls, [
      {
        productId: "470863",
        supplier: "OATLY EMEA AB",
        packagesNeeded: 1000,
        availablePackages: 600,
        missingPackages: 400,
        missingQuantity: { amount: 400, unit: "litre" },
      },
    ]);
    const read = await server.request("GET", `/api/quotes/${id}`, { token: BUYER });
    assert.equal(read.body.quote.status, "out_of_date");
  });

  it("keeps an out-of-date quote out of date even if stock returns", async () => {
    const id = await quoteOatly();
    valio.setAvailability("470863", { availableAmount: 600 });
    await recheck(id);
    valio.setAvailability("470863", { availableAmount: 1414 });
    const { body } = await recheck(id);
    assert.equal(body.quote.status, "out_of_date");
    assert.equal(body.changed, false);
  });

  it("returns 404 when rechecking an unknown quote", async () => {
    assert.equal((await recheck("Q-9999")).status, 404);
  });

  it("offers no way to set Valio Aimo's stock, and lets only the buyer start over", async () => {
    assert.equal((await server.request("POST", "/api/demo/stock", { token: BUYER, body: { productId: "470863", availablePackages: 0 } })).status, 404);
    assert.equal((await server.request("POST", "/api/demo/reset", { token: AGENT })).status, 403);
  });

  it("starting over clears quotes, orders, and reservations", async () => {
    const id = await quoteOatly();
    await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: id } });
    assert.equal((await server.request("GET", "/api/products/470863")).body.product.availablePackages, 414);
    const reset = await server.request("POST", "/api/demo/reset", { token: BUYER });
    assert.equal(reset.status, 200);
    assert.equal((await server.request("GET", "/api/products/470863")).body.product.availablePackages, 1414);
    assert.deepEqual((await server.request("GET", "/api/quotes", { token: BUYER })).body.quotes, []);
    assert.equal(await quoteOatly(), "Q-0001");
  });
});
