/**
 * Builds the semantic search index: an embedding of every product in
 * backend/data/catalog.json, written to backend/data/embeddings.bin (vectors)
 * and embeddings.json (model, size, product IDs). Uses Gemini or OpenAI, as the
 * agent does (AI_PROVIDER, or whichever key is set), and the catalog from
 * `npm run data`. Run with `npm run embeddings`; one to a few minutes.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/data/catalog.js";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDINGS_META_FILE,
  EMBEDDINGS_VECTOR_FILE,
  GEMINI_EMBEDDING_MODEL,
  embeddingText,
  geminiEmbedder,
  normalize,
  openAiEmbedder,
} from "../src/services/semantic.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const envFile = join(repo, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const provider = process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : process.env.GEMINI_API_KEY ? "gemini" : "");
const apiKey = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set GEMINI_API_KEY or OPENAI_API_KEY in .env, so the products can be embedded.");
const model = provider === "gemini" ? GEMINI_EMBEDDING_MODEL : EMBEDDING_MODEL;

const BATCH = 500;
const entries = loadCatalog();
const embed = provider === "gemini" ? geminiEmbedder(apiKey, "document") : openAiEmbedder(apiKey);
const vectors = new Float32Array(entries.length * EMBEDDING_DIMENSIONS);

for (let start = 0; start < entries.length; start += BATCH) {
  const batch = entries.slice(start, start + BATCH);
  const embedded = await embed(batch.map(embeddingText));
  embedded.forEach((vector, offset) => vectors.set(normalize(vector), (start + offset) * EMBEDDING_DIMENSIONS));
  process.stdout.write(`\rEmbedded ${Math.min(start + BATCH, entries.length)} of ${entries.length} products with ${model}`);
}

writeFileSync(EMBEDDINGS_VECTOR_FILE, Buffer.from(vectors.buffer));
writeFileSync(
  EMBEDDINGS_META_FILE,
  JSON.stringify({ model, dimensions: EMBEDDING_DIMENSIONS, builtAt: new Date().toISOString(), ids: entries.map((entry) => entry.id) }),
);
console.log(`\nWrote ${entries.length} embeddings (${model}, ${EMBEDDING_DIMENSIONS} dimensions) to ${EMBEDDINGS_VECTOR_FILE}`);
