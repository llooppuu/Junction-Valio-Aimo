import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RecordedValio } from "../src/services/valio.js";
import type { StoreOptions } from "../src/store.js";
import { AGENT, BUYER, recordedValio, startTestServer, type TestServer, testStore } from "./helpers.js";

let server: TestServer | undefined;
let valio: RecordedValio;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(policy?: StoreOptions["policy"], spendingLimitEurCents?: number) {
  valio = recordedValio();
  server = await startTestServer({
    store: testStore({ valio, ...(policy ? { policy } : {}), ...(spendingLimitEurCents ? { spendingLimitEurCents } : {}) }),
  });
  return server;
}

const litres = (amount: number) => ({ amount, unit: "litre" });

function quote(lines: unknown, extra: object = {}) {
  return server!.request("POST", "/api/quotes", { token: AGENT, body: { lines, ...extra } });
}

const outcome = (body: any, rule: string) => body.quote.permission.checks.find((check: { rule: string }) => check.rule === rule)?.outcome;
const detail = (body: any, rule: string) => body.quote.permission.checks.find((check: { rule: string }) => check.rule === rule)?.detail;

describe("buyer guardrails beyond spending", () => {
  it("shows the policy with every rule, read-only", async () => {
    await start();
    const { body } = await server!.request("GET", "/api/policy", { token: BUYER });
    assert.deepEqual(body.policies[0], {
      agentId: "demo-agent",
      agentName: "Hotel chain purchasing agent",
      buyerName: "Hotel chain",
      spendingLimitEurCents: 140000,
      dailyLimitEurCents: 140000,
      excludedAllergens: ["peanuts", "nuts"],
      preferredSuppliers: [],
      requiredLabels: [],
      requiredAttributes: { milk: ["lactose-free"] },
      nutritionMinimums: {},
      autonomy: { mode: "limits", approvalsToEarn: 3 },
    });
  });

  it("lists every check behind a decision, and keeps the plain reason when all rules pass", async () => {
    await start();
    const { body } = await quote([{ productId: "464306", quantity: litres(1000) }]);
    assert.equal(body.quote.status, "within_limit");
    assert.deepEqual(
      body.quote.permission.checks.map((check: { rule: string; outcome: string }) => `${check.rule}:${check.outcome}`),
      ["spending_limit:passed", "daily_limit:passed", "allergens:passed", "required_attributes:passed", "mandate:passed"],
    );
    assert.equal(detail(body, "allergens"), "free from peanuts and nuts");
  });

  it("sends milk that is not lactose-free for approval even within budget", async () => {
    await start();
    const { body } = await quote([{ productId: "463047", quantity: litres(100) }]);
    assert.equal(body.quote.totalEurCents, 20100);
    assert.equal(body.quote.status, "needs_approval");
    assert.equal(outcome(body, "spending_limit"), "passed");
    assert.equal(outcome(body, "required_attributes"), "needs_approval");
    assert.match(body.quote.permission.reason, /^The buyer must approve it: Arla Whole milk 1 L Suomesta low lactose Uht is not lactose-free/);
  });

  it("sends a product without an allergen declaration to a person, but accepts fresh produce", async () => {
    await start();
    // Canned coconut milk declares nothing, so it cannot be shown to be free from nuts.
    const coconut = await quote([{ productId: "460394", quantity: { amount: 4, unit: "package" } }]);
    assert.equal(coconut.body.quote.status, "needs_approval");
    assert.equal(outcome(coconut.body, "allergen_declaration"), "needs_approval");
    assert.match(detail(coconut.body, "allergen_declaration"), /has no allergen declaration from the manufacturer, so it cannot be shown to be free from peanuts and nuts/);
    // Loose beetroot rarely carries a declaration; the buyer's rules accept unprocessed fresh produce.
    const beetroot = await quote([{ productId: "460837", quantity: { amount: 20, unit: "kilogram" } }]);
    assert.equal(beetroot.body.quote.status, "within_limit");
    assert.equal(outcome(beetroot.body, "allergen_declaration"), "passed");
    assert.match(detail(beetroot.body, "allergen_declaration"), /unprocessed fresh produce without an allergen declaration, which the buyer's rules accept/);
  });

  it("sends a substitution from a non-preferred supplier for approval, and the buyer can approve it", async () => {
    await start({ preferredSuppliers: ["OATLY EMEA AB"] }, 1_000_000);
    const first = await quote([{ productId: "470863", quantity: litres(1000) }], { requirements: { deliverBy: "2026-11-16" } });
    assert.equal(first.body.quote.status, "within_limit");
    valio.setAvailability("470863", { availableAmount: 600 });
    await server!.request("POST", `/api/quotes/${first.body.quote.id}/recheck`, { token: AGENT });

    const replacement = await quote(
      [
        { productId: "470863", quantity: { amount: 600, unit: "package" } },
        { productId: "464306", quantity: litres(400) },
      ],
      { replacesQuoteId: first.body.quote.id },
    );
    assert.equal(replacement.body.quote.status, "needs_approval");
    assert.equal(outcome(replacement.body, "spending_limit"), "passed");
    assert.match(replacement.body.quote.permission.reason, /VALIO OY TUORE is not a preferred supplier/);

    const id = replacement.body.quote.id;
    assert.equal((await server!.request("POST", "/api/orders", { token: AGENT, body: { quoteId: id } })).status, 409);
    await server!.request("POST", `/api/quotes/${id}/decision`, { token: BUYER, body: { decision: "approve" } });
    assert.equal((await server!.request("POST", "/api/orders", { token: AGENT, body: { quoteId: id } })).status, 201);
  });

  it("blocks an allergen conflict outright, so there is nothing to approve, and records it", async () => {
    await start({ buyerName: "School kitchen", excludedAllergens: ["milk"] });
    const { status, body } = await quote([{ productId: "464306", quantity: litres(100) }]);
    assert.equal(status, 422);
    assert.equal(body.blocked, true);
    assert.match(body.error, /^Blocked by School kitchen's allergen rule: Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free \(VALIO OY TUORE\) contains milk\. This cannot be approved\./);
    assert.deepEqual((await server!.request("GET", "/api/quotes", { token: BUYER })).body.quotes, []);
    const audit = await server!.request("GET", "/api/audit", { token: BUYER });
    assert.equal(audit.body.entries[0].action, "quote.blocked");
    assert.match(audit.body.entries[0].reason, /cannot be approved/);
  });

  it("treats a may-contain trace as an allergen conflict", async () => {
    await start();
    // The hotel is nut-free, and this soya product may contain nuts from shared production.
    const { status, body } = await quote([{ productId: "460005", quantity: { amount: 2, unit: "package" } }]);
    assert.equal(status, 422);
    assert.match(body.error, /may contain nuts/);
  });

  it("sends a product below a nutrition minimum, or without a required label, for approval", async () => {
    await start({ nutritionMinimums: { "plant-based": { calciumMg: 100 } }, requiredLabels: ["eu-organic"] });
    const organic = await quote([{ productId: "460825", quantity: litres(12) }]);
    assert.equal(organic.body.quote.status, "needs_approval");
    assert.equal(outcome(organic.body, "nutrition"), "needs_approval");
    assert.equal(outcome(organic.body, "required_labels"), "passed");
    assert.match(organic.body.quote.permission.reason, /Oatly Oat Drink Organic 1L has 0 mg calcium per 100 (ml|g), below the 100 mg minimum/);

    const fortified = await quote([{ productId: "470863", quantity: litres(10) }]);
    assert.equal(outcome(fortified.body, "nutrition"), "passed");
    assert.equal(outcome(fortified.body, "required_labels"), "needs_approval");
    assert.match(fortified.body.quote.permission.reason, /has no eu-organic label/);
  });

  it("counts only what the agent committed on its own today toward its daily limit", async () => {
    await start();
    // An approved quote was signed off by a person, so it does not use up the agent's own daily limit.
    const big = await quote([{ productId: "464306", quantity: litres(1500) }]);
    await server!.request("POST", `/api/quotes/${big.body.quote.id}/decision`, { token: BUYER, body: { decision: "approve" } });
    const small = await quote([{ productId: "464306", quantity: litres(1000) }]);
    assert.equal(small.body.quote.status, "within_limit");

    // A quote that went out of date no longer commits anything.
    valio.setAvailability("464306", { availableAmount: 500 });
    await server!.request("POST", `/api/quotes/${small.body.quote.id}/recheck`, { token: AGENT });
    const again = await quote([{ productId: "470863", quantity: litres(600) }]);
    assert.equal(again.body.quote.totalEurCents, 84000);
    assert.equal(again.body.quote.status, "within_limit");
    assert.equal(outcome(again.body, "daily_limit"), "passed");
  });

  it("leaves quotes the buyer creates alone", async () => {
    await start({ excludedAllergens: ["milk"] });
    const { body } = await server!.request("POST", "/api/quotes", { token: BUYER, body: { lines: [{ productId: "464306", quantity: litres(10) }] } });
    assert.equal(body.quote.status, "approved");
    assert.deepEqual(body.quote.permission.checks, []);
  });
});
