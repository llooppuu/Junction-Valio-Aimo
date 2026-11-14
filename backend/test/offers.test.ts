import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestServer, type TestServer } from "./helpers.js";

describe("GET /api/offers", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  const LACTOSE_FREE = "category=milk&attributes=lactose-free&deliverBy=2026-11-16";
  type Offer = { rank: number; product: { id: string; co2PerKg?: number }; unitPriceEurCents: number; reason: string };

  async function rank(query: string) {
    const { status, body } = await server.request("GET", `/api/offers?${query}`);
    assert.equal(status, 200, JSON.stringify(body));
    return body as { rankBy: string; offers: Offer[]; unavailable: { productId: string; reason: string }[] };
  }

  it("ranks by price per litre by default, with the cheapest offer's reason", async () => {
    const body = await rank(LACTOSE_FREE);
    assert.equal(body.rankBy, "price");
    assert.deepEqual(body.offers.slice(0, 3).map((offer) => offer.product.id), ["464306", "464401", "464237"]);
    assert.equal(body.offers[0]!.unitPriceEurCents, 101);
    assert.equal(body.offers[0]!.reason, "The cheapest per litre in these results (€1.01), with 100% delivered as ordered and Finnish origin.");
    assert.deepEqual(body.offers.map((offer) => offer.rank), body.offers.map((_, index) => index + 1));
  });

  it("states each trade-off against the cheapest offer in plain language", async () => {
    const body = await rank(LACTOSE_FREE);
    const skimmed = body.offers.find((offer) => offer.product.id === "464401")!;
    assert.equal(skimmed.reason, "€0.09 more per litre than Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free, but Heart symbol.");
  });

  it("lists what cannot be delivered for the date, with the reason, instead of ranking it", async () => {
    const body = await rank(LACTOSE_FREE);
    const novobox = body.unavailable.find((offer) => offer.productId === "463038")!;
    assert.equal(novobox.reason, "the order cut-off for delivery on 2026-11-16 was Thursday 12 November at 15:00");
    assert.ok(!body.offers.some((offer) => offer.product.id === "463038"));
  });

  it("ranks by delivery date, labels, or carbon footprint", async () => {
    const delivery = await rank(`${LACTOSE_FREE}&rankBy=delivery`);
    assert.match(delivery.offers[0]!.reason, /^Earliest delivery, on Mon 16 Nov\./);

    const labels = await rank(`${LACTOSE_FREE}&rankBy=labels&preferLabels=heart-symbol`);
    assert.equal(labels.offers[0]!.product.id, "464401");
    assert.match(labels.offers[0]!.reason, /^Carries Heart symbol\./);

    // The carbon footprint is the average for the product's group, and the reason says so.
    const carbon = await rank("category=plant-based&rankBy=carbon");
    assert.match(carbon.offers[0]!.reason, /^Lowest carbon footprint, about 0\.43 kg CO2e per kg on average for its product group\./);
    const footprints = carbon.offers.map((offer) => offer.product.co2PerKg).filter((value): value is number => value !== undefined);
    assert.deepEqual(footprints, [...footprints].sort((a, b) => a - b));
  });

  it("compares prices only within the same unit", async () => {
    // Eggs are sold by the kilogram; an egg glaze spray sold by the litre is compared only with itself.
    const body = await rank("category=eggs");
    assert.equal(body.offers[0]!.product.id, "463982");
    for (const offer of body.offers as (Offer & { product: { packageSize: { unit: string } } })[]) {
      assert.doesNotMatch(offer.reason, offer.product.packageSize.unit === "kilogram" ? /per litre/ : /per kg/);
    }
  });

  it("applies the same filters as the catalog search", async () => {
    const body = await rank("category=plant-based&excludeAllergens=milk,gluten,soy");
    assert.ok(body.offers.length > 0);
    assert.ok(!body.offers.some((offer) => offer.product.id === "470863"), "Oatly contains gluten");
    assert.deepEqual((await rank("q=caviar")).offers, []);
  });

  it("rejects an unknown ranking", async () => {
    const { status } = await server.request("GET", "/api/offers?rankBy=vibes");
    assert.equal(status, 400);
  });
});
