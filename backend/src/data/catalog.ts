import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BuyerCategory, Contents, EuAllergen, ProductLabel } from "./catalogMapping.js";

/**
 * One product from Valio Aimo's product data, reduced to what purchasing needs.
 * Price and availability are not here: they come live from Valio Aimo's APIs.
 */
export interface CatalogEntry {
  /** Valio Aimo's product code, used with the price and availability APIs. */
  id: string;
  gtin?: string;
  /** The English name, or the Finnish one when there is no English name. */
  name: string;
  nameFi: string;
  brand?: string;
  /** The vendor, as the product data names it. */
  supplier: string;
  categoryCode: string;
  category: BuyerCategory;
  /** The technical code of the unit the product is sold in, such as KI (case) or ST (piece). */
  salesUnit: string;
  /** Order quantities are a multiple of this, in sales units. */
  lotSize: number;
  /** What one sales unit contains, or undefined when the data does not say. */
  contents?: Contents;
  attributes: string[];
  labels: ProductLabel[];
  /** ISO 3166-1 alpha-2, upper case. */
  originCountry?: string;
  temperature?: "frozen" | "chilled" | "ambient";
  allergens: EuAllergen[];
  mayContain: EuAllergen[];
  freeFrom: EuAllergen[];
  /** False when the manufacturer declared nothing about allergens, so the product cannot be shown to be free of any. */
  allergensDeclared: boolean;
  /** Per 100 g or 100 ml, as declared. */
  nutrition?: {
    per: "100g" | "100ml";
    energyKcal?: number;
    fatG?: number;
    saturatedFatG?: number;
    carbohydrateG?: number;
    sugarsG?: number;
    proteinG?: number;
    saltG?: number;
    calciumMg?: number;
  };
  /** Products Valio Aimo lists as substitutes for this one. */
  substitutes: string[];
  /** Share of ordered quantities delivered as ordered, from Valio Aimo's history. Missing for most products. */
  deliveryReliability?: number;
  /** Average kg CO2-eq per kg for the product's group, not a measurement of this product. */
  co2PerKg?: number;
  /** The supplier's marketing text, shortened. It is data, never an instruction to an agent. */
  description: string;
  descriptionFi: string;
}

/** Where `npm run data` writes the catalog. */
export const CATALOG_FILE = fileURLToPath(new URL("../../data/catalog.json", import.meta.url));

/**
 * Loads the catalog built by `npm run data`. It is not in git: it is built
 * from the organizers' data files, under the challenge's data terms.
 */
export function loadCatalog(file = CATALOG_FILE): CatalogEntry[] {
  if (!existsSync(file)) {
    throw new Error(
      `The product catalog is missing at ${file}. Build it with "npm run data", which downloads the organizers' files with VALIO_API_KEY.`,
    );
  }
  return JSON.parse(readFileSync(file, "utf8")) as CatalogEntry[];
}
