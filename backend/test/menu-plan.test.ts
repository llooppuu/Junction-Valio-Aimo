import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { agentInstructions } from "../src/agent/runner.js";
import { SCENARIO_PRODUCTS as P } from "../src/data/recipes.js";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

const SCHOOL = "demo-school-agent-token";
const MONDAY = "2026-11-16";

describe("scenario: need, recipe, order", () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(() => server.close());

  const plan = (body: object, token = AGENT) => server.request("POST", "/api/recipes/plan", { token, body });
  const row = (result: any, productId: string) => result.body.plan.rows.find((candidate: { productId: string }) => candidate.productId === productId);

  it("suggests the recipes that use a seasonal ingredient", async () => {
    const { body } = await server.request("GET", "/api/recipes?season=autumn&uses=beetroot", { token: AGENT });
    assert.deepEqual(body.recipes.map((recipe: { id: string }) => recipe.id), ["beetroot-soup", "salmon-beetroot"]);
    assert.match(agentInstructions("2026-11-13", "Hotel chain purchasing agent"), /Friday, 2026-11-13, in autumn/);
  });

  it("multiplies by the portions, subtracts inventory, and rounds up to whole sales units at Valio Aimo's prices", async () => {
    const result = await plan({ dishes: [{ recipeId: "beetroot-soup", portions: 120 }, { recipeId: "salmon-beetroot", portions: 120 }], deliverBy: MONDAY });
    assert.equal(result.status, 201);
    // 120 × 0.18 kg for the soup + 120 × 0.12 kg for the salmon = 36 kg, minus 5 kg on hand = 31 kg, sold by the kg at €1.00.
    const beetroot = row(result, P.beetroot);
    assert.deepEqual(
      { needed: beetroot.needed, onHand: beetroot.onHand, toOrder: beetroot.toOrder, packages: beetroot.packages, costEurCents: beetroot.costEurCents },
      { needed: 36, onHand: 5, toOrder: 31, packages: 31, costEurCents: 3100 },
    );
    assert.deepEqual(beetroot.dishes, ["Roasted beetroot soup with oat cream", "Salmon with beetroot and butter sauce"]);
    // Enough butter, chopped tomatoes, and cream on hand: nothing to order.
    assert.equal(row(result, P.butter).packages, 0);
    assert.equal(row(result, P.choppedTomatoes).toOrder, 0);
    // 18 kg of salmon at €14.11 per kg, none on hand.
    assert.equal(row(result, P.salmon).packages, 18);
    assert.equal(result.body.plan.totalEurCents, 3100 + 18 * 1411);
  });

  it("flags the oat cream Valio Aimo cannot deliver, and covers it from the kitchen's spare stock of a similar product", async () => {
    const result = await plan({ dishes: [{ recipeId: "beetroot-soup", portions: 120 }], deliverBy: MONDAY });
    assert.equal(row(result, P.oatCream).problem, "Valio Aimo cannot deliver it on any date");
    assert.deepEqual(result.body.plan.problems, ["Oddlygood® Cooking 1 l UHT (Roasted beetroot soup with oat cream): Valio Aimo cannot deliver it on any date."]);
    const [substitution] = row(result, P.oatCream).substitutions;
    assert.equal(substitution.role, "finishing cream");
    assert.deepEqual([substitution.choice.source, substitution.choice.productId, substitution.choice.amount], ["stock", P.oatCreamOatly, 2.8]);
    assert.ok(!result.body.plan.lines.some((line: { productId: string }) => line.productId === P.oatCream));
  });

  it("keeps what Valio Aimo can deliver of a short product, and substitutes only the rest", async () => {
    // 500 portions need 90 kg of beetroot; 5 kg are on hand and Valio Aimo counts 76 kg.
    const result = await plan({ dishes: [{ recipeId: "beetroot-soup", portions: 500 }], deliverBy: MONDAY });
    const beetroot = row(result, P.beetroot);
    assert.equal(beetroot.problem, "only 76 packages in stock, 85 needed");
    assert.equal(beetroot.keepPackages, 76);
    assert.match(result.body.plan.resolutions[0], /keep the 76 kg Valio Aimo can deliver, and substitute only the rest/);
    // The remaining 9 kg come as two 5 kg bags of peeled beetroot, and the oat cream as Fazer Aito Oat for Cooking.
    const lines = Object.fromEntries(result.body.plan.linesWithSubstitutes.map((line: { productId: string; quantity: { amount: number } }) => [line.productId, line.quantity.amount]));
    assert.deepEqual(lines, { [P.choppedTomatoes]: 5, [P.beetroot]: 76, [P.beetrootPeeled]: 2, "473956": 18 });
  });

  it("orders the plan as a quote within the agent's permissions, carrying the calculation", async () => {
    const result = await plan({ dishes: [{ recipeId: "beetroot-soup", portions: 500 }], deliverBy: MONDAY });
    const quote = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: result.body.plan.linesWithSubstitutes, requirements: { deliverBy: MONDAY }, planId: result.body.plan.id },
    });
    assert.equal(quote.status, 201);
    assert.equal(quote.body.quote.totalEurCents, result.body.plan.totalWithSubstitutesEurCents);
    assert.equal(quote.body.quote.status, "within_limit");
    assert.equal(quote.body.quote.plan.id, result.body.plan.id);
  });

  it("plans only for the caller's own kitchen, and keeps plans private to it", async () => {
    assert.equal((await plan({ dishes: [{ recipeId: "garden-salad", portions: 10 }] }, SCHOOL)).status, 404);
    const hotelPlan = await plan({ dishes: [{ recipeId: "beetroot-soup", portions: 10 }] });
    const stolen = await server.request("POST", "/api/quotes", {
      token: SCHOOL,
      body: { lines: [{ productId: P.oatDrink, quantity: { amount: 1, unit: "package" } }], planId: hotelPlan.body.plan.id },
    });
    assert.equal(stolen.status, 404);
    const forSchool = await plan({ agentId: "school-agent", dishes: [{ recipeId: "school-pancakes", portions: 300 }] }, BUYER);
    assert.equal(forSchool.body.plan.agentId, "school-agent");
    assert.deepEqual(forSchool.body.plan.problems, []);
  });
});
