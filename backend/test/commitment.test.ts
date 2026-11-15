import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { addDays } from "../src/services/dates.js";
import type { RecordedValio } from "../src/services/valio.js";
import { AGENT, BUYER, DELIVERY_DATE, FIXTURE_TIME, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

/**
 * An order commits only on what holds at that moment: the buyer's current
 * authority, Valio Aimo's current terms, and a quote that is still valid.
 * Each case here is a way an earlier decision could otherwise be reused.
 */
const MILK = { productId: "464306", quantity: { amount: 100, unit: "litre" } };

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(options: { earned?: boolean; valio?: RecordedValio; clock?: () => Date } = {}) {
  server = await startTestServer({
    store: testStore({ ...(options.earned ? { autonomy: "earned" as const } : {}), ...(options.valio ? { valio: options.valio } : {}), ...(options.clock ? { clock: options.clock } : {}) }),
  });
  return server;
}

const quoteAs = (s: TestServer, lines: object[] = [MILK]) => s.request("POST", "/api/quotes", { token: AGENT, body: { lines } });
const orderAs = (s: TestServer, quoteId: string, offerToken?: string) =>
  s.request("POST", "/api/orders", { token: AGENT, body: { quoteId, ...(offerToken ? { offerToken } : {}) } });

describe("authority is checked again when ordering", () => {
  it("sends the quote back to the buyer when earned autonomy was revoked after quoting", async () => {
    const s = await start({ earned: true });
    assert.equal((await s.request("POST", "/api/autonomy/demo-agent/categories/milk/grant", { token: BUYER, body: {} })).status, 200);
    const quote = await quoteAs(s);
    assert.equal(quote.body.quote.status, "within_limit");

    assert.equal((await s.request("POST", "/api/autonomy/demo-agent/categories/milk/revoke", { token: BUYER, body: {} })).status, 200);
    const order = await orderAs(s, quote.body.quote.id);
    assert.equal(order.status, 409);
    assert.match(order.body.error, /now needs the buyer's approval/);
    assert.equal(order.body.quoteStatus, "needs_approval");
    const after = await s.request("GET", `/api/quotes/${quote.body.quote.id}`, { token: BUYER });
    assert.equal(after.body.quote.status, "needs_approval");
    assert.match(after.body.quote.permission.reason, /^Checked again before ordering/);
    assert.deepEqual((await s.request("GET", "/api/orders", { token: BUYER })).body.orders, []);

    // The buyer can still approve it, and then the agent may order it.
    assert.equal((await s.request("POST", `/api/quotes/${quote.body.quote.id}/decision`, { token: BUYER, body: { decision: "approve" } })).status, 200);
    assert.equal((await orderAs(s, quote.body.quote.id)).status, 201);
  });

  it("does not order milk on a mandate the buyer has narrowed to vegetables and one cent", async () => {
    const s = await start();
    const quote = await quoteAs(s);
    assert.equal(quote.body.quote.status, "within_limit");
    const narrowed = await s.request("POST", "/api/mandates", {
      token: BUYER,
      body: { agentId: "demo-agent", allowedCategories: ["vegetables"], spendingLimitEurCents: 1 },
    });
    assert.equal(narrowed.status, 201, JSON.stringify(narrowed.body));

    const order = await orderAs(s, quote.body.quote.id);
    assert.equal(order.status, 409);
    assert.equal(order.body.quoteStatus, "needs_approval");
    assert.match(order.body.error, /outside the buyer's mandate/);
  });
});

describe("Valio Aimo's terms are checked again when ordering", () => {
  it("refuses an order whose delivery date has slipped, instead of keeping the quoted date", async () => {
    const valio = recordedValio();
    const s = await start({ valio });
    const quote = await quoteAs(s);
    assert.equal(quote.status, 201);
    const quotedDate = quote.body.quote.lines[0].deliveryDate;

    // Valio Aimo now delivers four days later than quoted.
    const current = (await valio.lookup(["464306"], DELIVERY_DATE)).availability.get("464306")!;
    const later = addDays(quotedDate, 4);
    valio.setAvailability("464306", { scheduleLines: current.scheduleLines.map((line) => ({ ...line, availableDate: later })) });

    const order = await orderAs(s, quote.body.quote.id);
    assert.equal(order.status, 409, JSON.stringify(order.body));
    assert.match(order.body.error, new RegExp(`now arrives on ${later}, not on ${quotedDate}`));
    assert.equal(order.body.changedTerms[0].kind, "delivery_date");
    const after = await s.request("GET", `/api/quotes/${quote.body.quote.id}`, { token: AGENT });
    assert.equal(after.body.quote.status, "out_of_date");
  });

  it("asks Valio Aimo afresh, past any cached answer", async () => {
    const valio = recordedValio();
    const s = await start({ valio });
    const quote = await quoteAs(s);
    const calls = valio.stats.calls;
    await orderAs(s, quote.body.quote.id);
    assert.ok(valio.stats.calls > calls, "the order made its own call to Valio Aimo");
  });
});

describe("a quote's validity is enforced on the server", () => {
  it("refuses an expired quote even when its signed offer is left out", async () => {
    let now = FIXTURE_TIME.getTime();
    const s = await start({ clock: () => new Date(now) });
    const quote = await quoteAs(s);
    assert.ok(quote.body.quote.expiresAt, "the quote says until when it holds");

    now += 25 * 60 * 60 * 1000;
    const order = await orderAs(s, quote.body.quote.id);
    assert.equal(order.status, 409);
    assert.match(order.body.error, /expired/);
    assert.equal(order.body.expired, true);
    const after = await s.request("GET", `/api/quotes/${quote.body.quote.id}`, { token: AGENT });
    assert.equal(after.body.quote.status, "out_of_date");
    assert.equal(after.body.quote.expired, true);
  });
});

describe("daily spending is counted when the agent commits", () => {
  it("counts a quote made yesterday on the day it is ordered", async () => {
    // Yesterday afternoon, the agent quotes €1,010 of milk within its €1,400 limit, and orders it this morning.
    let now = FIXTURE_TIME.getTime() - 20 * 60 * 60 * 1000;
    const s = await start({ clock: () => new Date(now) });
    const first = await quoteAs(s, [{ productId: "464306", quantity: { amount: 1000, unit: "litre" } }]);
    assert.equal(first.body.quote.status, "within_limit");
    now = FIXTURE_TIME.getTime();
    assert.equal((await orderAs(s, first.body.quote.id)).status, 201);

    // A further €600 today would take today's own-authority spending past the daily limit.
    const second = await quoteAs(s, [{ productId: "464306", quantity: { amount: 600, unit: "litre" } }]);
    assert.equal(second.body.quote.status, "needs_approval");
    const daily = second.body.quote.permission.checks.find((check: { rule: string }) => check.rule === "daily_limit");
    assert.equal(daily.outcome, "needs_approval");
  });
});
