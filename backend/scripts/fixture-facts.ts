/**
 * Prints what the test fixture says about products: price, contents, stock,
 * delivery, allergens, attributes, and labels, as an agent would see them at
 * the recording time. Usage: npm run fixture-facts -- [product codes]
 */
import { readFileSync } from "node:fs";
import type { CatalogEntry } from "../src/data/catalog.js";
import { toProduct } from "../src/services/market.js";

const catalog = JSON.parse(readFileSync("test/fixtures/catalog.json", "utf8")) as CatalogEntry[];
const fixture = JSON.parse(readFileSync("test/fixtures/valio.json", "utf8"));
const now = new Date(fixture.recordedAt);
const ids = process.argv.slice(2);
for (const entry of catalog) {
  if (ids.length > 0 && !ids.includes(entry.id)) continue;
  const recording = fixture.recordings[entry.id];
  const product = toProduct(entry, recording.price, recording.availability, fixture.timeNow, now);
  console.log(
    [
      product.id,
      product.category,
      product.name.slice(0, 44),
      `${product.salesUnit}=${product.packageSize.amount}${product.packageSize.unit[0]}`,
      `€${product.pricePerPackageEurCents}`,
      `${product.stockStatus}:${product.availablePackages}`,
      product.deliveryDate,
      product.unavailableReason ? `X:${product.unavailableReason.slice(0, 30)}` : "ok",
      product.allergensDeclared ? `[${product.allergens}|${product.mayContain}]` : "undeclared",
      product.attributes.join(","),
      product.labels.join(","),
      product.deliveryReliability ?? "",
      product.co2PerKg ?? "",
      product.substitutes.join(","),
    ].join(" | "),
  );
}
