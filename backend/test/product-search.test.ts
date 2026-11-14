import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

describe("searching the catalog in two steps", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  const search = async (query: string) => {
    const { status, body } = await server.request("GET", `/api/products?${query}`);
    assert.equal(status, 200, JSON.stringify(body));
    return body;
  };
  const ids = async (query: string) => (await search(query)).products.map((product: { id: string }) => product.id);

  it("finds the lactose-free milks that can cover 1,000 L by Monday, and says why the others cannot", async () => {
    const body = await search("category=milk&attributes=lactose-free&deliverBy=2026-11-16&minQuantity=1000&unit=litre");
    const found = body.products.map((product: { id: string }) => product.id);
    assert.ok(found.includes("464306"), "the cheapest per litre is among them");
    for (const product of body.products) {
      assert.ok(product.attributes.includes("lactose-free"));
      assert.equal(product.deliveryDate, "2026-11-16");
    }
    // The 10 l novobox is delivered from the supplier's warehouse, whose cut-off for Monday passed on Thursday.
    const novobox = body.excluded.find((product: { productId: string }) => product.productId === "463038");
    assert.deepEqual(novobox.reasons, ["the order cut-off for delivery on 2026-11-16 was Thursday 12 November at 15:00"]);
  });

  it("queries Valio Aimo only for the narrowed candidates", async () => {
    const valio = recordedValio();
    const local = await startTestServer({ store: testStore({ valio }) });
    try {
      const { body } = await local.request("GET", "/api/products?q=oat%20drink&limit=5");
      assert.equal(body.products.length, 5);
      assert.equal(valio.stats.calls, 1);
      assert.equal(valio.stats.productsRequested, 5);
    } finally {
      await local.close();
    }
  });

  it("searches Finnish and English names, all words required", async () => {
    const english = await ids("q=oat%20drink&limit=50");
    const finnish = await ids("q=kaurajuoma&limit=50");
    assert.ok(english.includes("470863") && finnish.includes("470863"), "Oatly Oat Drink Semi");
    assert.ok((await ids("q=EILA&limit=50")).length > 10, "case does not matter");
    assert.deepEqual(await ids("q=caviar"), []);
  });

  it("filters by attributes, labels, and unit, all of which must match", async () => {
    for (const id of await ids("category=plant-based&attributes=vegan,gluten-free&limit=50")) assert.ok(id);
    const msc = (await search("labels=msc&limit=50")).products;
    assert.ok(msc.length > 5 && msc.every((product: { labels: string[] }) => product.labels.includes("msc")));
    const eggs = (await search("category=eggs&unit=kilogram&limit=50")).products;
    assert.ok(eggs.every((product: { packageSize: { unit: string } }) => product.packageSize.unit === "kilogram"));
    // Milk powders are sold by the kilogram.
    const powders = (await search("category=milk&unit=kilogram")).products;
    assert.ok(powders.every((product: { packageSize: { unit: string } }) => product.packageSize.unit === "kilogram"));
  });

  it("returns 20 results by default and at most 50", async () => {
    assert.equal((await ids("category=milk")).length, 20);
    assert.equal((await ids("category=milk&limit=50")).length, 50);
    assert.equal((await server.request("GET", "/api/products?limit=51")).status, 400);
  });

  it("answers 503 in plain words when Valio Aimo does not answer, and never guesses", async () => {
    const valio = recordedValio();
    valio.failNextCalls(true);
    const local = await startTestServer({ store: testStore({ valio }) });
    try {
      const { status, body } = await local.request("GET", "/api/products?q=milk");
      assert.equal(status, 503);
      assert.match(body.error, /^Valio Aimo's price and availability service did not answer/);
      assert.match(body.error, /nothing was quoted or ordered/);
    } finally {
      await local.close();
    }
  });

  const invalid: [string, string][] = [
    ["minQuantity without a unit", "minQuantity=1000"],
    ["an invalid date", "deliverBy=next-monday"],
    ["a non-numeric quantity", "minQuantity=lots&unit=litre"],
    ["an unknown unit", "unit=gallon"],
    ["an unknown category", "category=caviar"],
    ["an unknown label", "labels=green"],
    ["an unknown allergen", "excludeAllergens=lactose"],
    ["an unknown parameter", "colour=blue"],
    ["a repeated parameter", "q=milk&q=eggs"],
  ];
  for (const [name, query] of invalid) {
    it(`rejects ${name} with an explanation`, async () => {
      const { status, body } = await server.request("GET", `/api/products?${query}`);
      assert.equal(status, 400);
      assert.equal(body.error, "Invalid request");
      assert.ok(body.details.length > 0 && body.details[0].message);
    });
  }
});
