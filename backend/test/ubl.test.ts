import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

/** An order as a PEPPOL BIS Order 3.0 document, for the person who forwards it or a system that imports it. */
describe("GET /api/orders/{id}/ubl", () => {
  let server: TestServer;
  let orderId: string;
  let total: number;
  before(async () => {
    server = await startTestServer();
    const quote = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: [{ productId: "464306", quantity: { amount: 1000, unit: "litre" } }] },
    });
    const order = await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: quote.body.quote.id } });
    orderId = order.body.order.id;
    total = order.body.order.totalEurCents;
  });
  after(() => server.close());

  const fetchUbl = (token: string, id = orderId) => fetch(`${server.baseUrl}/api/orders/${id}/ubl`, { headers: { Authorization: `Bearer ${token}` } });

  it("is a PEPPOL BIS Order 3.0 document with the order's fixed prices and delivery date", async () => {
    const response = await fetchUbl(AGENT);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/xml/);
    assert.match(response.headers.get("content-disposition") ?? "", new RegExp(`${orderId}\\.xml`));
    const xml = await response.text();
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<cbc:CustomizationID>urn:fdc:peppol\.eu:poacc:trns:order:3<\/cbc:CustomizationID>/);
    assert.match(xml, /<cbc:ProfileID>urn:fdc:peppol\.eu:poacc:bis:order_only:3<\/cbc:ProfileID>/);
    assert.match(xml, new RegExp(`<cbc:ID>${orderId}</cbc:ID>`));
    assert.match(xml, new RegExp(`<cbc:PayableAmount currencyID="EUR">${(total / 100).toFixed(2)}</cbc:PayableAmount>`));
    assert.match(xml, /<cbc:Quantity unitCode="H87">1000<\/cbc:Quantity>/);
    assert.match(xml, /<cbc:PriceAmount currencyID="EUR">1\.01<\/cbc:PriceAmount>/);
    assert.match(xml, /<cbc:ID schemeID="0160">\d{8,14}<\/cbc:ID>/, "the product's GTIN");
    assert.match(xml, /<cbc:Name>Hotel chain<\/cbc:Name>/);
    assert.match(xml, /Ordered by Hotel chain purchasing agent within its authority/);
    // Every element that opens is closed: a cheap well-formedness check without an XML parser.
    const opened = (xml.match(/<(cac|cbc):[A-Za-z]+[ >]/g) ?? []).length;
    const closed = (xml.match(/<\/(cac|cbc):[A-Za-z]+>/g) ?? []).length;
    assert.equal(opened, closed);
  });

  it("lets the buyer export any order, and hides another kitchen's from an agent", async () => {
    assert.equal((await fetchUbl(BUYER)).status, 200);
    assert.equal((await fetchUbl("demo-school-agent-token")).status, 404);
    assert.equal((await fetchUbl(AGENT, "O-9999")).status, 404);
  });
});
