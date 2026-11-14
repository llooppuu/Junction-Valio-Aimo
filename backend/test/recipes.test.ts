import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { recipes, SCENARIO_PRODUCTS } from "../src/data/recipes.js";
import { recipeSchema } from "../src/schemas/recipe.js";
import { AGENT, BUYER, fixtureCatalog, startTestServer, type TestServer } from "./helpers.js";

const SCHOOL = "demo-school-agent-token";

describe("recipes and kitchen inventory", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it("has at least five recipes, each ingredient tied to a real Valio Aimo product in its own unit", () => {
    const catalog = fixtureCatalog();
    assert.ok(recipes.length >= 5);
    for (const recipe of recipes) {
      for (const ingredient of recipe.ingredients) {
        const entry = catalog.find((candidate) => candidate.id === ingredient.productId);
        assert.ok(entry, `${recipe.id}: ${ingredient.productId}`);
        assert.equal(entry.contents?.unit, ingredient.quantityPerPortion.unit, `${recipe.id}: ${ingredient.name}`);
        assert.equal(entry.category, ingredient.category, `${recipe.id}: ${ingredient.name}`);
      }
    }
  });

  it("gives the same product different roles in different dishes, which substitution relies on", () => {
    const roleOf = (recipeId: string, productId: string) =>
      recipes.find((recipe) => recipe.id === recipeId)!.ingredients.find((ingredient) => ingredient.productId === productId)!.role;
    assert.equal(roleOf("tomato-pasta-sauce", SCENARIO_PRODUCTS.cherryTomatoes), "sauce base");
    assert.equal(roleOf("garden-salad", SCENARIO_PRODUCTS.cherryTomatoes), "salad garnish");
  });

  it("rejects a recipe with an unknown role or a quantity of zero", () => {
    const valid = recipes[0]!;
    const ingredient = valid.ingredients[0]!;
    assert.equal(recipeSchema.safeParse({ ...valid, ingredients: [{ ...ingredient, role: "decoration" }] }).success, false);
    assert.equal(recipeSchema.safeParse({ ...valid, ingredients: [{ ...ingredient, quantityPerPortion: { amount: 0, unit: "kilogram" } }] }).success, false);
  });

  it("shows each agent only its own kitchen's recipes", async () => {
    const hotel = await server.request("GET", "/api/recipes", { token: AGENT });
    const school = await server.request("GET", "/api/recipes", { token: SCHOOL });
    const buyer = await server.request("GET", "/api/recipes", { token: BUYER });
    assert.ok(hotel.body.recipes.every((recipe: { kitchens: string[] }) => recipe.kitchens.includes("demo-agent")));
    assert.deepEqual(school.body.recipes.map((recipe: { id: string }) => recipe.id), ["beetroot-soup", "school-pancakes"]);
    assert.equal(buyer.body.recipes.length, recipes.length);
    assert.equal((await server.request("GET", "/api/recipes/garden-salad", { token: SCHOOL })).status, 404);
    assert.equal((await server.request("GET", "/api/recipes/garden-salad", { token: AGENT })).status, 200);
    assert.equal((await server.request("GET", "/api/recipes")).status, 401);
  });

  it("serves each kitchen's inventory, and an agent sees only its own", async () => {
    const hotel = await server.request("GET", "/api/inventory", { token: AGENT });
    assert.deepEqual(hotel.body.kitchens.map((kitchen: { agentId: string }) => kitchen.agentId), ["demo-agent"]);
    const beetroot = hotel.body.kitchens[0].items.find((item: { productId: string }) => item.productId === SCENARIO_PRODUCTS.beetroot);
    assert.deepEqual(beetroot.quantity, { amount: 5, unit: "kilogram" });
    const school = await server.request("GET", "/api/inventory?agentId=demo-agent", { token: SCHOOL });
    assert.deepEqual(school.body.kitchens.map((kitchen: { agentId: string }) => kitchen.agentId), ["school-agent"]);
    const both = await server.request("GET", "/api/inventory", { token: BUYER });
    assert.deepEqual(both.body.kitchens.map((kitchen: { buyerName: string }) => kitchen.buyerName), ["Hotel chain", "School kitchen"]);
    assert.equal((await server.request("GET", "/api/inventory?agentId=nobody", { token: BUYER })).status, 400);
  });
});
