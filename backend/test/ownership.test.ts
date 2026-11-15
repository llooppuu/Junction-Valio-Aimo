import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

const SCHOOL = "demo-school-agent-token";

/** Each kitchen's purchasing records are its own: another kitchen's agent cannot list, read, or act on them. */
describe("an agent sees only its own kitchen's quotes and orders", () => {
  let server: TestServer;
  let quoteId: string;
  let orderId: string;
  before(async () => {
    server = await startTestServer();
    const quote = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: [{ productId: "464306", quantity: { amount: 100, unit: "litre" } }] },
    });
    quoteId = quote.body.quote.id;
    const order = await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId } });
    orderId = order.body.order.id;
  });
  after(() => server.close());

  it("leaves the other kitchen's quotes out of the list and answers them as not found", async () => {
    const list = await server.request("GET", "/api/quotes", { token: SCHOOL });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.quotes, []);
    assert.equal((await server.request("GET", `/api/quotes/${quoteId}`, { token: SCHOOL })).status, 404);
    assert.equal((await server.request("GET", `/api/quotes/${quoteId}/audit`, { token: SCHOOL })).status, 404);
    assert.equal((await server.request("POST", `/api/quotes/${quoteId}/recheck`, { token: SCHOOL })).status, 404);
    assert.equal((await server.request("GET", `/api/quotes/${quoteId}/shortfall-options`, { token: SCHOOL })).status, 404);
  });

  it("does the same for orders, in JSON and as PEPPOL documents", async () => {
    const list = await server.request("GET", "/api/orders", { token: SCHOOL });
    assert.deepEqual(list.body.orders, []);
    assert.equal((await server.request("GET", `/api/orders/${orderId}`, { token: SCHOOL })).status, 404);
    const ubl = await fetch(`${server.baseUrl}/api/orders/${orderId}/ubl`, { headers: { Authorization: `Bearer ${SCHOOL}` } });
    assert.equal(ubl.status, 404);
  });

  it("still shows the owning agent its own records, and the buyer everything", async () => {
    assert.equal((await server.request("GET", "/api/quotes", { token: AGENT })).body.quotes.length, 1);
    assert.equal((await server.request("GET", `/api/orders/${orderId}`, { token: AGENT })).status, 200);
    assert.equal((await server.request("GET", "/api/quotes", { token: BUYER })).body.quotes.length, 1);
    assert.equal((await server.request("GET", "/api/orders", { token: BUYER })).body.orders.length, 1);
  });
});
