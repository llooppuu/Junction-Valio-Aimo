import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AGENT, startTestServer, type TestServer } from "./helpers.js";

interface Result {
  requested: { productId: string; packages: number; unmet: string[] };
  substitutes: {
    tier: string;
    productId: string;
    productName: string;
    matchScore: number;
    matchNotes: string[];
    tradeOff: string;
    packages: number;
    costEurCents: number;
    scores: { similarity: number; price: number; preference: number; availability: number; combined: number };
    scoreNotes: { price: string; preference: string; availability: string };
  }[];
  excluded: { productId: string; reasons: string[] }[];
}

describe("GET /api/substitutes", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  async function substitutes(query: string, token?: string): Promise<Result> {
    const { status, body } = await server.request("GET", `/api/substitutes?${query}`, token ? { token } : {});
    assert.equal(status, 200, JSON.stringify(body));
    return body;
  }
  const tiers = (result: Result) => Object.fromEntries(result.substitutes.map((s) => [s.tier, s.productId]));
  const excludedReason = (result: Result, id: string) => result.excluded.find((e) => e.productId === id)?.reasons.join("; ");

  it("labels the top three by combined score best, better, and good, each with its trade-off", async () => {
    const result = await substitutes("productId=470863&amount=48&unit=litre");
    assert.deepEqual(result.requested.unmet, []);
    assert.deepEqual(tiers(result), { best: "472145", better: "470889", good: "473278" });
    const combined = result.substitutes.map((s) => s.scores.combined);
    assert.deepEqual(combined, [...combined].sort((a, b) => b - a));
    const [best] = result.substitutes;
    assert.match(best!.matchNotes.join(), /similar product: oat, drink/);
    assert.equal(best!.tradeOff, "€3.36 less than the requested product (€63.84 in total).");
  });

  it("breaks every substitute's score into similarity, price, preference, and availability, weighted 30, 25, 20, and 25", async () => {
    const result = await substitutes("productId=470863&amount=48&unit=litre");
    for (const substitute of result.substitutes) {
      const { similarity, price, preference, availability, combined } = substitute.scores;
      assert.equal(combined, Math.round(0.3 * similarity + 0.25 * price + 0.2 * preference + 0.25 * availability), substitute.productId);
      for (const value of [similarity, price, preference, availability]) assert.ok(value >= 0 && value <= 100);
    }
    assert.deepEqual(result.substitutes[0]!.scoreNotes, {
      price: "5% less per litre than the requested product",
      preference: "same supplier as requested, the requested product had no labels to keep",
      availability: "stock covers the order 2 times over; no delivery record",
    });
  });

  it("finds a milk-free, gluten-free drink for an oat drink, and never adds an allergen unless the buyer allows it", async () => {
    const strict = await substitutes("productId=470863&amount=48&unit=litre&excludeAllergens=milk,gluten");
    assert.deepEqual(strict.requested.unmet, ["contains gluten"]);
    assert.equal(strict.substitutes[0]!.productId, "473424", "Alpro rice drink");
    assert.equal(excludedReason(strict, "460443"), "adds nuts, which the requested product does not contain");

    const allowed = await substitutes("productId=470863&amount=48&unit=litre&excludeAllergens=milk,gluten&allowNewAllergens=true");
    assert.ok(allowed.substitutes.some((s) => s.productId === "474864"), "an almond drink, once nuts are allowed");
  });

  it("never proposes lactose-free milk when milk is excluded, and offers plant-based drinks instead", async () => {
    const result = await substitutes("productId=464306&amount=48&unit=litre&excludeAllergens=milk");
    assert.deepEqual(result.requested.unmet, ["contains milk"]);
    assert.equal(excludedReason(result, "464201"), "contains milk");
    assert.ok(result.substitutes.length > 0);
    for (const substitute of result.substitutes) assert.match(substitute.matchNotes.join(), /a plant based instead of milk/);
  });

  it("applies the calling agent's own rules: the nut-free hotel is never offered nuts", async () => {
    // Alpro's almond drinks declare nuts; even with new allergens allowed, the hotel's own rule keeps them out.
    const open = await substitutes("productId=470863&amount=48&unit=litre&excludeAllergens=milk,gluten&allowNewAllergens=true");
    assert.ok(open.substitutes.length > 0);
    const hotel = await substitutes("productId=470863&amount=48&unit=litre&excludeAllergens=milk,gluten&allowNewAllergens=true", AGENT);
    assert.ok(hotel.substitutes.length > 0);
    assert.ok(!hotel.substitutes.some((s) => s.productId === "460443" || s.productId === "461360"));
    assert.ok(!hotel.excluded.some((entry) => entry.productId === "460443"), "nut products are not even considered");
  });

  it("explains why the request cannot be met and finds a replacement for a product Valio Aimo cannot deliver", async () => {
    const result = await substitutes("productId=469094&amount=20&unit=litre&role=finishing%20cream");
    assert.deepEqual(result.requested.unmet, ["Valio Aimo cannot deliver it on any date", "out of stock"]);
    assert.deepEqual(tiers(result), { best: "473956", better: "460697", good: "467622" });
    assert.match(result.substitutes[0]!.matchNotes.join(), /similar product: cooking/);
    assert.equal(excludedReason(result, "472966"), "Valio Aimo cannot deliver it on any date; out of stock");
  });

  it("excludes substitutes that miss the date or lack stock, with the reason", async () => {
    const result = await substitutes("productId=470863&amount=2000&unit=litre&deliverBy=2026-11-16");
    assert.deepEqual(result.requested.unmet, ["only 1414 packages in stock, 2000 needed"]);
    assert.equal(result.substitutes[0]!.productId, "468465");
    assert.equal(excludedReason(result, "470889"), "only 249 packages in stock, 2000 needed");
    assert.match(excludedReason(result, "471424")!, /the order cut-off for delivery on 2026-11-16 was Thursday 12 November at 15:00/);
  });

  it("converts a request in packages to the substitute's own package size", async () => {
    // 3 cases of 18 × 2.5 dl is 13.5 L, which is 14 one-litre cartons.
    const result = await substitutes("productId=461174&amount=3&unit=package");
    assert.equal(result.requested.packages, 3);
    assert.equal(result.substitutes[0]!.packages, 14);
  });

  it("rejects an unknown product or a mismatched unit", async () => {
    assert.equal((await server.request("GET", "/api/substitutes?productId=caviar&amount=1&unit=package")).status, 404);
    assert.equal((await server.request("GET", "/api/substitutes?productId=462545&amount=1&unit=litre")).status, 400);
    assert.equal((await server.request("GET", "/api/substitutes?productId=462545")).status, 400);
  });
});
