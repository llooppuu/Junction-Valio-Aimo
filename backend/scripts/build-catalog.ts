/**
 * Builds backend/data/catalog.json from Valio Aimo's challenge data: the
 * product file, delivery reliability, and carbon footprint. Downloads the
 * files with VALIO_API_KEY and keeps only the built catalog.
 * Run with `npm run data`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_FILE, type CatalogEntry } from "../src/data/catalog.js";
import {
  allergenFromGs1,
  attributeFromClaim,
  buyerCategory,
  labelFromCode,
  salesUnitContents,
  TEMPERATURE_CODES,
  type EuAllergen,
  type ProductLabel,
} from "../src/data/catalogMapping.js";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const envFile = join(repo, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const DOWNLOADS = {
  products: "/api/products/download",
  reliability: "/api/delivery-reliability/download",
  carbon: "/api/carbon-footprint/download",
};

async function source(kind: keyof typeof DOWNLOADS): Promise<string> {
  const key = process.env.VALIO_API_KEY;
  const base = process.env.VALIO_API_URL ?? "https://junction26.valioaimo.fi";
  if (!key) throw new Error(`VALIO_API_KEY is not set in .env, so Valio Aimo's ${kind} file cannot be downloaded.`);
  console.log(`Downloading ${kind} from ${base}${DOWNLOADS[kind]}`);
  const response = await fetch(`${base}${DOWNLOADS[kind]}`, { headers: { "X-API-Key": key }, redirect: "follow" });
  if (!response.ok) throw new Error(`Download of ${kind} failed with HTTP ${response.status}.`);
  return response.text();
}

function csv(text: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [id, value] = line.split(",");
    if (id && value !== undefined && value.trim() !== "" && Number.isFinite(Number(value))) values.set(id.trim(), Number(value));
  }
  return values;
}

type Text = { value: string; language: string };
type Raw = {
  id: string;
  salesUnitGtin?: string;
  salesUnit: string;
  category: string;
  allowedLotSize: number;
  vendorName: string;
  countryOfOrigin?: string;
  substitutions?: { product: string; substituteProduct: string }[];
  units?: { unitId: string; sizeInBaseUnits: number }[];
  synkkaData?: {
    brand?: string;
    names?: Text[];
    marketingTexts?: Text[];
    classifications?: { name: string; values: { id: string; unit?: string; value?: number }[] }[];
    nutritionalContent?: { id: string; value: number; basisQuantity: number; basisQuantityUnit: string }[];
  };
};

const text = (texts: Text[] | undefined, language: string) => texts?.find((entry) => entry.language === language)?.value?.trim();
const shorten = (value: string | undefined, max = 280) => {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : clean;
};
const unique = <T>(values: T[]) => [...new Set(values)];

const NUTRIENTS: Record<string, keyof NonNullable<CatalogEntry["nutrition"]>> = {
  "ENER-E14": "energyKcal",
  FAT: "fatG",
  FASAT: "saturatedFatG",
  CHOAVL: "carbohydrateG",
  "SUGAR-": "sugarsG",
  "PRO-": "proteinG",
  SALTEQ: "saltG",
  CA: "calciumMg",
};

function nutrition(raw: Raw): CatalogEntry["nutrition"] {
  const declared = raw.synkkaData?.nutritionalContent ?? [];
  if (declared.length === 0) return undefined;
  const result: NonNullable<CatalogEntry["nutrition"]> = { per: declared[0]!.basisQuantityUnit === "MLT" ? "100ml" : "100g" };
  for (const nutrient of declared) {
    const key = NUTRIENTS[nutrient.id];
    if (key && key !== "per" && nutrient.basisQuantity === 100) result[key] = nutrient.value;
  }
  // Calcium is often declared only among the minerals.
  const calcium = raw.synkkaData?.classifications?.find((group) => group.name === "mineral")?.values.find((value) => value.id === "CA");
  if (result.calciumMg === undefined && calcium?.value !== undefined) result.calciumMg = calcium.value;
  return result;
}

function entry(raw: Raw, reliability: Map<string, number>, carbon: Map<string, number>): CatalogEntry {
  const groups = raw.synkkaData?.classifications ?? [];
  const values = (name: string) => groups.find((group) => group.name === name)?.values ?? [];
  const nameEn = text(raw.synkkaData?.names, "en");
  const nameFi = text(raw.synkkaData?.names, "fi") ?? nameEn ?? raw.id;
  const name = nameEn ?? nameFi;

  const contains: EuAllergen[] = [];
  const mayContain: EuAllergen[] = [];
  const freeFrom: EuAllergen[] = [];
  for (const value of [...values("allergen"), ...values("nonAllergen")]) {
    const allergen = allergenFromGs1(value.id);
    if (!allergen) continue;
    if (value.unit === "CONTAINS") contains.push(allergen);
    else if (value.unit === "MAY_CONTAIN") mayContain.push(allergen);
    else if (value.unit === "FREE_FROM") freeFrom.push(allergen);
  }
  const allergens = unique(contains);
  const traces = unique(mayContain).filter((allergen) => !allergens.includes(allergen));
  const free = unique(freeFrom).filter((allergen) => !allergens.includes(allergen) && !traces.includes(allergen));
  const declared = [...values("allergen"), ...values("nonAllergen")].some((value) => value.unit !== "UNDECLARED");

  const labels = unique(values("packagingMarkedLabel").map((value) => labelFromCode(value.id)).filter((label): label is ProductLabel => !!label));
  const temperature = values("packagingMarkedLabel").map((value) => TEMPERATURE_CODES[value.id]).find(Boolean);
  const attributes = values("nutritionalClaim").map((value) => attributeFromClaim(value.id)).filter((attribute): attribute is string => !!attribute);
  const names = `${nameFi} ${name}`.toLowerCase();
  if (/laktoositon|lactose[- ]?free/.test(names)) attributes.push("lactose-free");
  if (/gluteeniton|gluten[- ]?free/.test(names)) attributes.push("gluten-free");
  if (declared && !allergens.includes("milk") && !traces.includes("milk") && freeFrom.includes("milk")) attributes.push("milk-free");
  if (labels.includes("eu-organic")) attributes.push("organic");
  if (temperature) attributes.push(temperature);

  const contents = salesUnitContents([nameFi, name], raw.salesUnit, raw.units ?? []);
  return {
    id: raw.id,
    ...(raw.salesUnitGtin ? { gtin: raw.salesUnitGtin } : {}),
    name,
    nameFi,
    ...(raw.synkkaData?.brand ? { brand: raw.synkkaData.brand } : {}),
    supplier: raw.vendorName,
    categoryCode: raw.category,
    category: buyerCategory(raw.category),
    salesUnit: raw.salesUnit,
    lotSize: raw.allowedLotSize >= 1 ? raw.allowedLotSize : 1,
    ...(contents ? { contents } : {}),
    attributes: unique(attributes),
    labels,
    ...(raw.countryOfOrigin ? { originCountry: raw.countryOfOrigin.toUpperCase() } : {}),
    ...(temperature ? { temperature } : {}),
    allergens,
    mayContain: traces,
    freeFrom: free,
    allergensDeclared: declared,
    ...(nutrition(raw) ? { nutrition: nutrition(raw) } : {}),
    substitutes: unique((raw.substitutions ?? []).filter((rule) => rule.product === raw.id).map((rule) => rule.substituteProduct)),
    ...(reliability.has(raw.id) ? { deliveryReliability: reliability.get(raw.id) } : {}),
    ...(carbon.has(raw.id) ? { co2PerKg: carbon.get(raw.id) } : {}),
    description: shorten(text(raw.synkkaData?.marketingTexts, "en")),
    descriptionFi: shorten(text(raw.synkkaData?.marketingTexts, "fi")),
  };
}

const [products, reliabilityText, carbonText] = await Promise.all([source("products"), source("reliability"), source("carbon")]);
const reliability = csv(reliabilityText);
const carbon = csv(carbonText);
const entries = (JSON.parse(products) as Raw[]).map((raw) => entry(raw, reliability, carbon));

mkdirSync(dirname(CATALOG_FILE), { recursive: true });
writeFileSync(CATALOG_FILE, JSON.stringify(entries));

const count = (test: (item: CatalogEntry) => boolean) => entries.filter(test).length;
const categories = new Map<string, number>();
for (const item of entries) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
console.log(`Wrote ${entries.length} products to ${CATALOG_FILE}`);
console.log(`  contents known: ${count((item) => !!item.contents)}, allergens declared: ${count((item) => item.allergensDeclared)}`);
console.log(`  reliability: ${count((item) => item.deliveryReliability !== undefined)}, carbon footprint: ${count((item) => item.co2PerKg !== undefined)}`);
console.log(`  categories: ${[...categories].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(", ")}`);
