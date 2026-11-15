import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { CatalogEntry } from "../data/catalog.js";

/**
 * Search by meaning. Every product has an embedding of its names (Finnish and
 * English), brand, category, attributes, and descriptions in both languages, built once by
 * `npm run embeddings`. A query is embedded the same way and products are
 * ranked by cosine similarity, so "something plant-based for cooking" finds
 * oat cooking cream even when no word matches, in either language.
 */

export const EMBEDDINGS_META_FILE = fileURLToPath(new URL("../../data/embeddings.json", import.meta.url));
export const EMBEDDINGS_VECTOR_FILE = fileURLToPath(new URL("../../data/embeddings.bin", import.meta.url));
export const EMBEDDING_MODEL = "text-embedding-3-small";
/** The Gemini model for the same index, when the AI provider is Gemini. */
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
/** Shortened vectors keep the index small (17,546 × 512 floats, about 36 MB) and still match Finnish queries well. */
export const EMBEDDING_DIMENSIONS = 512;

export interface SemanticIndex {
  model: string;
  dimensions: number;
  ids: string[];
  /** Unit-length vectors, one after another. */
  vectors: Float32Array;
  rowOf: Map<string, number>;
}

export type Embedder = (texts: string[]) => Promise<number[][]>;

/** The text a product is embedded from. */
export function embeddingText(entry: CatalogEntry): string {
  return [entry.name, entry.nameFi, entry.brand, entry.category, entry.attributes.join(", "), entry.description.slice(0, 200), entry.descriptionFi.slice(0, 200)]
    .filter((part) => part && part.length > 0)
    .join(" | ");
}

export function normalize(vector: ArrayLike<number>): Float32Array {
  let length = 0;
  for (let i = 0; i < vector.length; i++) length += vector[i]! * vector[i]!;
  const scale = length > 0 ? 1 / Math.sqrt(length) : 0;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! * scale;
  return out;
}

export function createIndex(ids: string[], vectors: number[][], model = EMBEDDING_MODEL): SemanticIndex {
  const dimensions = vectors[0]?.length ?? EMBEDDING_DIMENSIONS;
  const flat = new Float32Array(ids.length * dimensions);
  vectors.forEach((vector, row) => flat.set(normalize(vector), row * dimensions));
  return { model, dimensions, ids, vectors: flat, rowOf: new Map(ids.map((id, row) => [id, row])) };
}

/** The index built by `npm run embeddings`, or undefined when it has not been built. */
export function loadIndex(): SemanticIndex | undefined {
  if (!existsSync(EMBEDDINGS_META_FILE) || !existsSync(EMBEDDINGS_VECTOR_FILE)) return undefined;
  const meta = JSON.parse(readFileSync(EMBEDDINGS_META_FILE, "utf8")) as { model: string; dimensions: number; ids: string[] };
  const bytes = readFileSync(EMBEDDINGS_VECTOR_FILE);
  const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (vectors.length !== meta.ids.length * meta.dimensions) return undefined;
  return { ...meta, vectors, rowOf: new Map(meta.ids.map((id, row) => [id, row])) };
}

/** Embeds texts with OpenAI, in the index's model and size. */
export function openAiEmbedder(apiKey: string, model = EMBEDDING_MODEL, dimensions = EMBEDDING_DIMENSIONS): Embedder {
  const client = new OpenAI({ apiKey, maxRetries: 2, timeout: 30_000 });
  return async (texts) => {
    const response = await client.embeddings.create({ model, input: texts, dimensions });
    return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  };
}

/**
 * Embeds texts with Gemini, in the index's size. Products and queries are
 * embedded for retrieval with their own task types, as Gemini recommends.
 * Gemini takes up to 100 texts per call; a rate limit is waited out and retried.
 */
export function geminiEmbedder(apiKey: string, purpose: "document" | "query", model = GEMINI_EMBEDDING_MODEL, dimensions = EMBEDDING_DIMENSIONS): Embedder {
  const ai = new GoogleGenAI({ apiKey });
  const taskType = purpose === "document" ? "RETRIEVAL_DOCUMENT" : "RETRIEVAL_QUERY";
  return async (texts) => {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += 100) {
      const batch = texts.slice(start, start + 100);
      for (let attempt = 1; ; attempt++) {
        try {
          const response = await ai.models.embedContent({ model, contents: batch, config: { taskType, outputDimensionality: dimensions } });
          vectors.push(...(response.embeddings ?? []).map((embedding) => embedding.values ?? []));
          break;
        } catch (error) {
          const limited = /429|RESOURCE_EXHAUSTED|rate/i.test(error instanceof Error ? error.message : String(error));
          if (!limited || attempt >= 6) throw error;
          await new Promise((resolve) => setTimeout(resolve, 15_000 * attempt));
        }
      }
    }
    return vectors;
  };
}

/** Whether an index was built with Gemini, so queries must be embedded with Gemini too. */
export const isGeminiIndex = (index: { model: string }) => index.model.startsWith("gemini");

/** Ranks the given catalog entries by similarity to the query vector. */
export function rankBySimilarity(index: SemanticIndex, query: Float32Array, entries: readonly CatalogEntry[], limit: number): { entry: CatalogEntry; score: number }[] {
  const scored: { entry: CatalogEntry; score: number }[] = [];
  const { dimensions, vectors } = index;
  for (const entry of entries) {
    const row = index.rowOf.get(entry.id);
    if (row === undefined) continue;
    let dot = 0;
    const offset = row * dimensions;
    for (let i = 0; i < dimensions; i++) dot += vectors[offset + i]! * query[i]!;
    scored.push({ entry, score: dot });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Embeds a query once and remembers the most recent ones, since the catalog view repeats searches. */
export function createQueryEmbedder(embedder: Embedder, size = 200) {
  const cache = new Map<string, Float32Array>();
  return async (text: string): Promise<Float32Array> => {
    const key = text.trim().toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;
    const [vector] = await embedder([key]);
    const normalized = normalize(vector ?? []);
    cache.set(key, normalized);
    if (cache.size > size) cache.delete(cache.keys().next().value!);
    return normalized;
  };
}
