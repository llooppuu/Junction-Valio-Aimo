/**
 * Finds real products for a search pattern and shows Valio Aimo's live price
 * and availability for each, to choose products for the scenarios.
 * Usage: node --import tsx scripts/find-products.ts "<category>" "<regex>" [more pairs]
 */
import { config } from "../src/config.js";
import { loadCatalog } from "../src/data/catalog.js";
import { nextDeliveryDate } from "../src/services/dates.js";
import { toProduct } from "../src/services/market.js";
import { createHttpValio } from "../src/services/valio.js";

if (!config.VALIO_API_KEY) throw new Error("VALIO_API_KEY is not set");
const catalog = loadCatalog();
const valio = createHttpValio({ apiKey: config.VALIO_API_KEY, baseUrl: config.VALIO_API_URL });
const date = process.env.DATE ?? nextDeliveryDate(new Date());
const args = process.argv.slice(2);

for (let index = 0; index < args.length; index += 2) {
  const category = args[index]!;
  const pattern = new RegExp(args[index + 1]!, "i");
  const matches = catalog.filter((entry) => (category === "*" || entry.category === category) && (pattern.test(entry.nameFi) || pattern.test(entry.name))).slice(0, 25);
  console.log(`\n## ${category} /${args[index + 1]}/ — ${matches.length} shown, delivery ${date}`);
  if (matches.length === 0) continue;
  const answer = await valio.lookup(matches.map((entry) => entry.id), date);
  for (const entry of matches) {
    const product = toProduct(entry, answer.prices.get(entry.id), answer.availability.get(entry.id), answer.timeNow, new Date());
    const unitPrice = product.packageSize.unit !== "piece" ? (product.pricePerPackageEurCents / product.packageSize.amount / 100).toFixed(2) : "-";
    console.log(
      [
        entry.id,
        entry.name.slice(0, 48).padEnd(48),
        `${entry.salesUnit} ${product.packageSize.amount}${product.packageSize.unit[0]}(${product.packageSizeSource[0]})`,
        `€${(product.pricePerPackageEurCents / 100).toFixed(2)} (${unitPrice}/u)`,
        `${product.stockStatus}:${product.availablePackages}`,
        product.deliveryDate,
        product.unavailableReason ? `X ${product.unavailableReason.slice(0, 40)}` : "ok",
        `[${entry.allergensDeclared ? entry.allergens.join("+") || "none" : "undeclared"}]`,
        entry.attributes.filter((attribute) => !["chilled", "ambient", "frozen"].includes(attribute)).join(","),
        entry.nutrition?.calciumMg !== undefined ? `Ca${entry.nutrition.calciumMg}` : "",
        entry.deliveryReliability !== undefined ? `rel${entry.deliveryReliability}` : "",
      ].join(" | "),
    );
  }
}
console.log(`\nValio calls: ${valio.stats.calls}, products requested: ${valio.stats.productsRequested}`);
