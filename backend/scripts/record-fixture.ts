/**
 * Records a slice of the real catalog and Valio Aimo's answers for it, so the
 * tests replay real prices and availability without calling the APIs. Run with
 * `npm run record-fixture` after `npm run data`. The tests fix their clock to
 * the recording time, so cut-off times compare the same way on every run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { loadCatalog, type CatalogEntry } from "../src/data/catalog.js";
import { launches } from "../src/data/launches.js";
import { nextMonday } from "../src/data/plannedOrders.js";
import { SCENARIO_PRODUCTS } from "../src/data/recipes.js";
import { helsinkiDate } from "../src/services/dates.js";
import { substituteCandidates } from "../src/services/market.js";
import { createHttpValio, type ValioRecording } from "../src/services/valio.js";

if (!config.VALIO_API_KEY) throw new Error("VALIO_API_KEY is not set");
const entries = loadCatalog();
const byId = new Map(entries.map((entry) => [entry.id, entry]));
// substituteCandidates only reads the catalog, so a minimal store shape is enough here.
const store = { catalog: { entries, byId } } as unknown as Parameters<typeof substituteCandidates>[0];

const ids = new Set<string>();
for (const entry of entries) if (["milk", "cream", "plant-based", "eggs"].includes(entry.category)) ids.add(entry.id);
const seeds = [...Object.values(SCENARIO_PRODUCTS), ...launches.map((launch) => launch.productId)];
for (const id of seeds) {
  ids.add(id);
  for (const candidate of substituteCandidates(store, id, 30)) ids.add(candidate.id);
}

const recordedAt = new Date();
const requestedDate = nextMonday(helsinkiDate(recordedAt));
const valio = createHttpValio({ apiKey: config.VALIO_API_KEY, baseUrl: config.VALIO_API_URL });
const answer = await valio.lookup([...ids], requestedDate);

const recordings: Record<string, ValioRecording> = {};
const catalog: CatalogEntry[] = [];
for (const id of [...ids].sort()) {
  const price = answer.prices.get(id);
  const availability = answer.availability.get(id);
  if (!price || !availability) continue;
  recordings[id] = { price, availability };
  catalog.push(byId.get(id)!);
}

const dir = fileURLToPath(new URL("../test/fixtures/", import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}catalog.json`, `${JSON.stringify(catalog)}\n`);
writeFileSync(`${dir}valio.json`, `${JSON.stringify({ recordedAt: recordedAt.toISOString(), timeNow: answer.timeNow, requestedDate, recordings }, null, 1)}\n`);
console.log(`Recorded ${catalog.length} products for delivery on ${requestedDate}, answered at ${answer.timeNow}, in ${valio.stats.calls} calls.`);
