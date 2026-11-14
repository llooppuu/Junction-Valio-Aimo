import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createIndex, embeddingText, type Embedder } from "../src/services/semantic.js";
import { fixtureCatalog, startTestServer, type TestServer, testStore } from "./helpers.js";

/**
 * Search by meaning, with a small deterministic embedder in place of OpenAI:
 * each dimension counts words for one idea, in English or Finnish, so the
 * ranking can be checked without calling an API.
 */
const IDEAS: string[][] = [
  ["oat", "kaura", "plant", "kasvi", "soy", "soija", "vegan"],
  ["milk", "maito", "dairy"],
  ["cheese", "juusto", "emmental"],
  ["cooking", "ruoan", "cream", "kerma", "kerman"],
];
const fakeEmbedder: Embedder = async (texts) =>
  texts.map((text) => {
    const words = text.toLowerCase().split(/[^a-zäöå]+/);
    return [0.05, ...IDEAS.map((idea) => words.filter((word) => idea.some((stem) => word.startsWith(stem))).length)];
  });

async function semanticServer(options: { index?: boolean; embedder?: boolean } = {}) {
  const entries = fixtureCatalog();
  const index = createIndex(
    entries.map((entry) => entry.id),
    await fakeEmbedder(entries.map(embeddingText)),
  );
  return startTestServer({
    store: testStore({ semanticIndex: options.index === false ? null : index, embedder: options.embedder === false ? null : fakeEmbedder }),
  });
}

describe("search by meaning", () => {
  let server: TestServer;
  before(async () => {
    server = await semanticServer();
  });
  after(() => server.close());

  it("embeds both names, the category, attributes, and descriptions", () => {
    const text = embeddingText(fixtureCatalog().find((entry) => entry.id === "464306")!);
    assert.match(text, /semi skimmed milk drink/);
    assert.match(text, /kevytmaitojuoma/);
    assert.match(text, /lactose-free/);
  });

  it("finds a plant-based cooking product where no word of the query matches", async () => {
    const query = encodeURIComponent("plant-based instead of cream");
    const keyword = await server.request("GET", `/api/products?q=${query}`);
    assert.equal(keyword.body.products.length, 0, "the keyword search finds nothing");
    const { body } = await server.request("GET", `/api/products?q=${query}&search=semantic&limit=5`);
    assert.equal(body.source.search, "semantic");
    assert.ok(body.products.some((product: { category: string }) => product.category === "plant-based"), "a plant-based product is among the best matches");
  });

  it("understands the same need in Finnish", async () => {
    const { body } = await server.request("GET", `/api/products?q=${encodeURIComponent("kasvipohjainen kerman sijaan")}&search=semantic&limit=5`);
    assert.ok(body.products.some((product: { category: string }) => product.category === "plant-based"));
  });

  it("keeps every filter: excluded allergens never come back", async () => {
    const { body } = await server.request("GET", `/api/products?q=milk&search=semantic&excludeAllergens=milk&limit=10`);
    assert.ok(body.products.every((product: { allergens: string[]; mayContain: string[] }) => !product.allergens.includes("milk") && !product.mayContain.includes("milk")));
  });
});

describe("search by meaning when it is not available", () => {
  it("falls back to the keyword search without an index, and says why", async () => {
    const server = await semanticServer({ index: false });
    try {
      const { body } = await server.request("GET", "/api/products?q=milk&search=semantic");
      assert.equal(body.source.search, "keyword");
      assert.match(body.source.searchFallback, /npm run embeddings/);
      assert.ok(body.products.length > 0);
    } finally {
      await server.close();
    }
  });

  it("falls back without an embedding key", async () => {
    const server = await semanticServer({ embedder: false });
    try {
      const { body } = await server.request("GET", "/api/products?q=milk&search=semantic");
      assert.equal(body.source.search, "keyword");
      assert.match(body.source.searchFallback, /OPENAI_API_KEY/);
    } finally {
      await server.close();
    }
  });
});
