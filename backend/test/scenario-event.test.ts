import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { executeTool } from "../src/agent/tools.js";
import { SCENARIO_PRODUCTS as P } from "../src/data/recipes.js";
import type { RecordedValio } from "../src/services/valio.js";
import { AGENT, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

const CHERRY = P.cherryTomatoes; // CHERRYTOMATOES 4KG LOOSE
const CHOPPED = P.choppedTomatoes; // Gustodoro chopped tomatoes 1 kg, on hand in the kitchen
const BRAVO = "463947"; // Bravo Chef chopped tomatoes 2.5 kg
const PLUM = "465239"; // BABY PLUM TOMATO 4KG, Valio Aimo's listed substitute for the cherry tomatoes
const SAUCE = "Roast tomato pasta sauce";
const SALAD = "Garden salad with cherry tomatoes and Emmental";
const MONDAY = "2026-11-16";

describe("scenario: last-minute event", () => {
  let server: TestServer;
  let valio: RecordedValio;
  beforeEach(async () => {
    valio = recordedValio();
    server = await startTestServer({ store: testStore({ valio }) });
  });
  afterEach(() => server.close());

  const substitutes = (role?: string, deliverBy = MONDAY) =>
    server.request("GET", `/api/substitutes?productId=${CHERRY}&amount=3&unit=kilogram&deliverBy=${deliverBy}${role ? `&role=${encodeURIComponent(role)}` : ""}`);
  const ids = (list: { productId: string }[]) => list.map((entry) => entry.productId);
  const eventPlan = (deliverBy = MONDAY) =>
    server.request("POST", "/api/recipes/plan", {
      token: AGENT,
      body: { dishes: [{ recipeId: "tomato-pasta-sauce", portions: 60 }, { recipeId: "garden-salad", portions: 60 }], deliverBy },
    });
  const cherryRow = (plan: any) => plan.rows.find((row: { productId: string }) => row.productId === CHERRY);

  it("lets chopped tomatoes replace cherry tomatoes in a sauce but not in a salad", async () => {
    valio.setAvailability(CHERRY, { availableAmount: 0 });
    const sauce = (await substitutes("sauce base")).body;
    assert.equal(sauce.substitutes[0].productId, PLUM, "Valio Aimo's own substitute comes first");
    const bravo = sauce.substitutes.find((entry: { productId: string }) => entry.productId === BRAVO);
    assert.ok(bravo.matchNotes.includes("suits a sauce base"));

    const salad = (await substitutes("salad garnish")).body;
    assert.deepEqual(ids(salad.substitutes), [PLUM]);
    assert.deepEqual(salad.excluded.find((entry: { productId: string }) => entry.productId === CHOPPED).reasons, ["processed, so it cannot be used as a salad garnish"]);

    // Without a role it stays a like-for-like swap: processed products are not considered at all.
    const plain = (await substitutes()).body;
    assert.ok(![...ids(plain.substitutes), ...ids(plain.excluded)].includes(BRAVO));
  });

  it("rejects an unknown role", async () => {
    assert.equal((await substitutes("garnish of choice")).status, 400);
  });

  it("flags the sold-out tomatoes and proposes a substitute per dish, by the ingredient's role", async () => {
    valio.setAvailability(CHERRY, { availableAmount: 0 });
    const { status, body } = await eventPlan();
    assert.equal(status, 201);
    const plan = body.plan;
    assert.deepEqual(plan.problems, [`CHERRYTOMATOES 4KG LOOSE ES/MA/FR/NL (${SAUCE}, ${SALAD}): none available for ${MONDAY}.`]);

    // 60 × 0.05 kg for the sauce + 60 × 0.08 kg for the salad, with 1 kg on hand going to the sauce first.
    const row = cherryRow(plan);
    assert.deepEqual(row.uses, [
      { dish: SAUCE, role: "sauce base", needed: 3 },
      { dish: SALAD, role: "salad garnish", needed: 4.8 },
    ]);
    const [sauce, salad] = row.substitutions;
    // The sauce takes 2 kg of the chopped tomatoes the kitchen has spare.
    assert.equal(sauce.shortfall, 2);
    assert.deepEqual((({ source, productId, amount }) => ({ source, productId, amount }))(sauce.choice), { source: "stock", productId: CHOPPED, amount: 2 });
    assert.match(sauce.note, /no order needed\. It suits a sauce base\./);
    // The salad needs fresh tomatoes: processed ones are ruled out, so it orders baby plum tomatoes for Monday.
    assert.equal(salad.shortfall, 4.8);
    assert.deepEqual((({ source, productId, deliveryDate }) => ({ source, productId, deliveryDate }))(salad.choice), { source: "order", productId: PLUM, deliveryDate: MONDAY });
    assert.ok(ids(salad.ruledOut).includes(CHOPPED));

    assert.deepEqual(plan.linesWithSubstitutes, [
      { productId: P.eggs, quantity: { amount: 1, unit: "package" } },
      { productId: PLUM, quantity: { amount: 2, unit: "package" } },
    ]);
    assert.equal(plan.totalWithSubstitutesEurCents, 3101 + 2 * 1930);
  });

  it("says so when nothing suitable can arrive in time", async () => {
    valio.setAvailability(CHERRY, { availableAmount: 0 });
    // Valio Aimo's earliest delivery is Monday, so nothing ordered can arrive by Sunday.
    const plan = (await eventPlan("2026-11-15")).body.plan;
    const [sauce, salad] = cherryRow(plan).substitutions;
    // The kitchen's own stock needs no delivery, so the sauce is still covered.
    assert.equal(sauce.choice.source, "stock");
    assert.equal(salad.choice, undefined);
    assert.equal(salad.note, "No substitute suits a salad garnish and arrives in time. Change the dish or ask the buyer.");
  });

  it("keeps the salmon Valio Aimo can deliver for a big booking, and tops it up with the same kind of fish", async () => {
    // 300 portions need 45 kg of salmon; Valio Aimo counts 43 kg.
    const plan = (await server.request("POST", "/api/recipes/plan", { token: AGENT, body: { dishes: [{ recipeId: "salmon-beetroot", portions: 300 }], deliverBy: MONDAY } })).body.plan;
    assert.deepEqual(plan.problems, ["SALMON FILLET C-CUT (Salmon with beetroot and butter sauce): only 43 packages in stock, 45 needed."]);
    const [substitution] = plan.rows.find((row: { productId: string }) => row.productId === P.salmon).substitutions;
    assert.equal(substitution.role, "main protein");
    assert.deepEqual([substitution.choice.source, substitution.choice.productId], ["order", "471555"]);
    const lines = Object.fromEntries(plan.linesWithSubstitutes.map((line: { productId: string; quantity: { amount: number } }) => [line.productId, line.quantity.amount]));
    assert.equal(lines[P.salmon], 43);
    assert.equal(lines["471555"], 2);
    // Herring would change the dish, so it is never proposed for a salmon main course.
    const options = (await server.request("GET", `/api/substitutes?productId=${P.salmon}&amount=2&unit=kilogram&deliverBy=${MONDAY}&role=main%20protein`)).body;
    for (const option of options.substitutes) assert.match(option.matchNotes.join(), /the same kind of protein \(salmon or trout\)/);
  });

  it("quotes the substitutions with the plan attached", async () => {
    valio.setAvailability(CHERRY, { availableAmount: 0 });
    const plan = (await eventPlan()).body.plan;
    const quote = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: plan.linesWithSubstitutes, planId: plan.id, requirements: { deliverBy: MONDAY } },
    });
    assert.equal(quote.status, 201);
    assert.equal(quote.body.quote.totalEurCents, plan.totalWithSubstitutesEurCents);
    assert.equal(quote.body.quote.status, "within_limit");
    assert.equal(cherryRow(quote.body.quote.plan).substitutions[1].choice.productId, PLUM);
  });

  it("passes the role from the agent's tool to the API", async () => {
    valio.setAvailability(CHERRY, { availableAmount: 0 });
    const execution = await executeTool(
      { baseUrl: `${server.baseUrl}/api`, token: AGENT },
      "find_substitutes",
      JSON.stringify({ productId: CHERRY, amount: 3, unit: "kilogram", deliverBy: MONDAY, role: "salad garnish" }),
    );
    assert.match(execution.path, /role=salad\+garnish/);
    assert.equal(execution.httpStatus, 200);
    assert.ok(!ids((execution.body as { substitutes: { productId: string }[] }).substitutes).includes(CHOPPED));
  });
});
