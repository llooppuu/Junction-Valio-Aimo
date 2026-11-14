import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { RecordedValio } from "../src/services/valio.js";
import { AGENT, BUYER, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

// 1,000 cartons of Oatly (€1,400.00, from 1,414 counted) and 100 L of Arki Eila (€101.00): €1,501.00 in total.
const OVER_LIMIT = {
  lines: [
    { productId: "470863", quantity: { amount: 1000, unit: "litre" } },
    { productId: "464306", quantity: { amount: 100, unit: "litre" } },
  ],
};

describe("buyer approval", () => {
  let server: TestServer;
  let valio: RecordedValio;
  let quoteId: string;

  const decide = (body: unknown, token = BUYER, id = quoteId) => server.request("POST", `/api/quotes/${id}/decision`, { token, body });

  beforeEach(async () => {
    valio = recordedValio();
    server = await startTestServer({ store: testStore({ valio }) });
    const { body } = await server.request("POST", "/api/quotes", { token: AGENT, body: OVER_LIMIT });
    quoteId = body.quote.id;
    assert.equal(body.quote.status, "needs_approval");
  });
  afterEach(() => server.close());

  it("lets the buyer approve the exact quote", async () => {
    const { status, body } = await decide({ decision: "approve", note: "Event this weekend" });
    assert.equal(status, 200);
    assert.equal(body.quote.status, "approved");
    assert.equal(body.quote.totalEurCents, 150100);
    assert.deepEqual(body.quote.buyerDecision.by, { id: "demo-buyer", name: "Head chef" });
    assert.equal(body.quote.buyerDecision.note, "Event this weekend");
  });

  it("lets the buyer reject the quote", async () => {
    const { body } = await decide({ decision: "reject" });
    assert.equal(body.quote.status, "rejected");
    assert.equal(body.quote.buyerDecision.decision, "reject");
  });

  it("refuses the agent's credentials with 403", async () => {
    assert.equal((await decide({ decision: "approve" }, AGENT)).status, 403);
    const quote = await server.request("GET", `/api/quotes/${quoteId}`, { token: BUYER });
    assert.equal(quote.body.quote.status, "needs_approval");
  });

  it("refuses a second decision", async () => {
    await decide({ decision: "reject" });
    const { status, body } = await decide({ decision: "approve" });
    assert.equal(status, 409);
    assert.match(body.error, /is rejected/);
  });

  it("refuses to decide a quote that did not need approval", async () => {
    const small = await server.request("POST", "/api/quotes", { token: AGENT, body: { lines: [{ productId: "463982", quantity: { amount: 1, unit: "package" } }] } });
    assert.equal((await decide({ decision: "approve" }, BUYER, small.body.quote.id)).status, 409);
  });

  it("asks Valio Aimo again, and marks the quote out of date instead of approving it after stock falls", async () => {
    valio.setAvailability("470863", { availableAmount: 990 });
    const { status, body } = await decide({ decision: "approve" });
    assert.equal(status, 409);
    assert.equal(body.shortfalls[0].missingPackages, 10);
    const quote = await server.request("GET", `/api/quotes/${quoteId}`, { token: BUYER });
    assert.equal(quote.body.quote.status, "out_of_date");
  });

  it("validates the decision", async () => {
    assert.equal((await decide({ decision: "maybe" })).status, 400);
    assert.equal((await decide({ decision: "approve", totalEurCents: 1 })).status, 400);
    assert.equal((await decide({ decision: "approve" }, BUYER, "Q-9999")).status, 404);
  });
});
