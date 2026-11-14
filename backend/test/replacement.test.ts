import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { RecordedValio } from "../src/services/valio.js";
import { AGENT, BUYER, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

const REQUIREMENTS = { attributes: ["milk-free"], deliverBy: "2026-11-16" };

describe("replacing a quote after a shortfall", () => {
  let server: TestServer;
  let valio: RecordedValio;
  let originalId: string;

  const createQuote = (body: unknown) => server.request("POST", "/api/quotes", { token: AGENT, body });

  // 1,000 L of Oatly Oat Drink Semi, then Valio Aimo's count falls from 1,414 to 600.
  beforeEach(async () => {
    valio = recordedValio();
    server = await startTestServer({ store: testStore({ valio }) });
    const created = await createQuote({ lines: [{ productId: "470863", quantity: { amount: 1000, unit: "litre" } }], requirements: REQUIREMENTS });
    originalId = created.body.quote.id;
    valio.setAvailability("470863", { availableAmount: 600 });
    await server.request("POST", `/api/quotes/${originalId}/recheck`, { token: AGENT });
  });
  afterEach(() => server.close());

  it("ranks close substitutes for the missing 400 L by cost, and explains every exclusion", async () => {
    const { status, body } = await server.request("GET", `/api/quotes/${originalId}/shortfall-options`, { token: AGENT });
    assert.equal(status, 200);
    const [plan] = body.plans;
    assert.deepEqual(plan.keep, { productId: "470863", packages: 600 });
    assert.deepEqual(
      plan.options.map((option: { productId: string; packages: number; costEurCents: number }) => [option.productId, option.packages, option.costEurCents]),
      [
        ["461174", 89, 100659],
        ["464226", 89, 101638],
      ],
    );
    const reasons = Object.fromEntries(plan.excluded.map((item: { productId: string; reasons: string[] }) => [item.productId, item.reasons.join("; ")]));
    assert.match(reasons["470863"], /no stock left after what the quote already uses/);
    assert.match(reasons["470889"], /only 249 packages free, 400 needed/);
    assert.match(reasons["464320"], /not milk-free/);
  });

  it("creates the replacement and links both quotes, keeping the requirements", async () => {
    const { status, body } = await createQuote({
      replacesQuoteId: originalId,
      lines: [
        { productId: "470863", quantity: { amount: 600, unit: "package" } },
        { productId: "461174", quantity: { amount: 400, unit: "litre" } },
      ],
    });
    assert.equal(status, 201);
    assert.equal(body.quote.totalEurCents, 600 * 140 + 89 * 1131);
    assert.equal(body.quote.status, "needs_approval");
    assert.equal(body.quote.replacesQuoteId, originalId);
    assert.deepEqual(body.quote.requirements, REQUIREMENTS);
    const original = await server.request("GET", `/api/quotes/${originalId}`, { token: AGENT });
    assert.equal(original.body.quote.replacedBy, body.quote.id);
  });

  it("refuses a replacement that cannot be delivered or breaks a requirement", async () => {
    const undeliverable = await createQuote({ replacesQuoteId: originalId, lines: [{ productId: "467974", quantity: { amount: 400, unit: "litre" } }] });
    assert.equal(undeliverable.status, 422);
    assert.match(undeliverable.body.error, /Valio Aimo cannot deliver it on any date/);
    const notMilkFree = await createQuote({ replacesQuoteId: originalId, lines: [{ productId: "464320", quantity: { amount: 400, unit: "litre" } }] });
    assert.equal(notMilkFree.status, 422);
    assert.match(notMilkFree.body.error, /not milk-free/);
  });

  it("refuses to replace a quote twice or replace one that is not out of date", async () => {
    const lines = [{ productId: "461174", quantity: { amount: 400, unit: "litre" } }];
    const first = await createQuote({ replacesQuoteId: originalId, lines });
    assert.equal((await createQuote({ replacesQuoteId: originalId, lines })).status, 409);
    assert.equal((await createQuote({ replacesQuoteId: first.body.quote.id, lines })).status, 409);
    assert.equal((await createQuote({ replacesQuoteId: "Q-9999", lines })).status, 404);
  });

  it("refuses shortfall options for a quote without a shortfall", async () => {
    const fresh = await createQuote({ lines: [{ productId: "463982", quantity: { amount: 1, unit: "package" } }] });
    assert.equal((await server.request("GET", `/api/quotes/${fresh.body.quote.id}/shortfall-options`, { token: AGENT })).status, 409);
  });

  it("lets the agent replace a rejected quote with an alternative, which gets its own check", async () => {
    valio.setAvailability("470863", { availableAmount: 1414 });
    const overLimit = await createQuote({
      lines: [
        { productId: "470863", quantity: { amount: 1000, unit: "litre" } },
        { productId: "461174", quantity: { amount: 100, unit: "litre" } },
      ],
      requirements: REQUIREMENTS,
    });
    const rejectedId = overLimit.body.quote.id;
    assert.equal(overLimit.body.quote.status, "needs_approval");
    await server.request("POST", `/api/quotes/${rejectedId}/decision`, { token: BUYER, body: { decision: "reject" } });

    const alternative = await createQuote({ replacesQuoteId: rejectedId, lines: [{ productId: "470863", quantity: { amount: 600, unit: "package" } }] });
    assert.equal(alternative.status, 201);
    assert.equal(alternative.body.quote.status, "within_limit");
    assert.deepEqual(alternative.body.quote.requirements, REQUIREMENTS);
    const old = await server.request("GET", `/api/quotes/${rejectedId}`, { token: AGENT });
    assert.equal(old.body.quote.status, "rejected");
    assert.equal(old.body.quote.replacedBy, alternative.body.quote.id);
    const history = await server.request("GET", `/api/quotes/${rejectedId}/audit`, { token: AGENT });
    const replaced = history.body.entries.find((entry: { action: string }) => entry.action === "quote.replaced");
    assert.match(replaced.reason, /buyer rejected the original quote/);
  });

  it("refuses to replace a quote that can still be ordered, and says what to do instead", async () => {
    const fresh = await createQuote({ lines: [{ productId: "463982", quantity: { amount: 1, unit: "package" } }] });
    const { status, body } = await createQuote({ replacesQuoteId: fresh.body.quote.id, lines: [{ productId: "463982", quantity: { amount: 2, unit: "package" } }] });
    assert.equal(status, 409);
    assert.match(body.error, /Only an out-of-date or rejected quote can be replaced\. For a new need, create a quote without replacesQuoteId/);
  });

  it("enforces requirements on ordinary quotes too", async () => {
    const { status, body } = await createQuote({ lines: [{ productId: "463047", quantity: { amount: 10, unit: "litre" } }], requirements: { attributes: ["lactose-free"] } });
    assert.equal(status, 422);
    assert.deepEqual(body.unmet, ["not lactose-free"]);
  });
});
