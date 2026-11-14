import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { productSchema } from "../src/schemas/product.js";
import { AGENT, startTestServer, type TestServer } from "./helpers.js";

describe("GS1 allergen codes and containment levels", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  const ids = async (query: string) => {
    const { status, body } = await server.request("GET", `/api/products?${query}`);
    assert.equal(status, 200, JSON.stringify(body));
    return body.products.map((product: { id: string }) => product.id);
  };

  it("publishes the GS1 code for each of the 14 EU allergens", async () => {
    const { status, body } = await server.request("GET", "/api/allergens");
    assert.equal(status, 200);
    assert.equal(body.standard, "GS1 AllergenTypeCode");
    assert.deepEqual(body.levelsOfContainment, ["CONTAINS", "MAY_CONTAIN", "FREE_FROM"]);
    assert.equal(body.allergens.length, 14);
    const codes = Object.fromEntries(body.allergens.map((entry: { allergen: string; gs1Code: string }) => [entry.allergen, entry.gs1Code]));
    assert.equal(codes.milk, "AM");
    assert.equal(codes.gluten, "AW");
    assert.equal(codes.nuts, "AN");
    assert.equal(new Set(Object.values(codes)).size, 14);
  });

  it("returns the manufacturer's GS1 statements, including free-from claims", async () => {
    // Oatly declares gluten (from oats) and that it is free from the other thirteen.
    const { body } = await server.request("GET", "/api/products/470863");
    const statements = body.product.allergenStatements;
    assert.deepEqual(statements[0], { allergenTypeCode: "AW", levelOfContainment: "CONTAINS", allergen: "gluten" });
    assert.equal(statements.filter((statement: { levelOfContainment: string }) => statement.levelOfContainment === "FREE_FROM").length, 13);
    assert.ok(statements.some((statement: { allergen: string; levelOfContainment: string }) => statement.allergen === "milk" && statement.levelOfContainment === "FREE_FROM"));
    // Lactose-free milk contains milk and claims nothing: the trap, in the standard's own terms.
    const milk = await server.request("GET", "/api/products/464306");
    assert.deepEqual(milk.body.product.allergenStatements, [{ allergenTypeCode: "AM", levelOfContainment: "CONTAINS", allergen: "milk" }]);
  });

  it("filters by GS1 code, sub-code, or name, with the same result", async () => {
    const byCode = await ids("category=plant-based&excludeAllergens=AM,AW,AY&limit=50");
    const byName = await ids("category=plant-based&excludeAllergens=milk,gluten,soy&limit=50");
    assert.deepEqual(byCode, byName);
    assert.ok(byCode.includes("473424"), "Alpro rice drink is free from all three");
    assert.ok(!byCode.includes("470863"), "Oatly contains gluten");
    // UW is wheat, a cereal containing gluten.
    assert.deepEqual(await ids("category=plant-based&excludeAllergens=UW&limit=50"), await ids("category=plant-based&excludeAllergens=gluten&limit=50"));
    assert.equal((await server.request("GET", "/api/products?excludeAllergens=ZZ")).status, 400);
  });

  it("leaves out products without a declaration, except unprocessed fresh produce", async () => {
    // Canned tomatoes without a declaration cannot be shown to be milk-free.
    const pantry = await ids("category=pantry&excludeAllergens=milk&limit=50");
    assert.ok(!pantry.includes("463947"), "Bravo Chef chopped tomatoes declare nothing");
    assert.ok(pantry.includes("471551"), "Gustodoro chopped tomatoes declare their allergens");
    // Loose vegetables rarely carry a declaration; the buyer's rules accept that.
    const { body } = await server.request("GET", "/api/products?category=vegetables&excludeAllergens=milk&limit=10");
    assert.ok(body.products.length > 0);
    assert.ok(body.products.every((product: { allergensDeclared: boolean }) => !product.allergensDeclared));
  });

  it("accepts GS1 codes in quote requirements, and refuses a conflict with the readable reason", async () => {
    const { status, body } = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: {
        lines: [{ productId: "464306", quantity: { amount: 10, unit: "litre" } }],
        requirements: { excludeAllergens: ["AM"] },
      },
    });
    assert.equal(status, 422);
    assert.match(body.error, /contains milk/);
  });

  it("never lets a product claim to be free from something it contains", async () => {
    const { body } = await server.request("GET", "/api/products/464306");
    const { availableQuantity: _quantity, allergenStatements: _statements, offer: _offer, ...milk } = body.product;
    assert.ok(productSchema.safeParse(milk).success);
    assert.equal(productSchema.safeParse({ ...milk, freeFrom: ["milk"] }).success, false);
  });
});
