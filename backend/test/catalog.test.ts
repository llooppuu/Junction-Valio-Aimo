import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { CatalogEntry } from "../src/data/catalog.js";
import { allergenFromGs1, buyerCategory, labelFromCode, parseNameSize, salesUnitContents } from "../src/data/catalogMapping.js";
import { productSchema } from "../src/schemas/product.js";
import { toProduct, UNLIMITED_PACKAGES } from "../src/services/market.js";
import type { ValioAvailability, ValioPrice } from "../src/services/valio.js";
import { startTestServer, type TestServer } from "./helpers.js";

describe("mapping Valio Aimo's product data", () => {
  it("maps category codes to buyer categories by what the product is", () => {
    assert.equal(buyerCategory("10400"), "milk");
    assert.equal(buyerCategory("10401"), "cream");
    assert.equal(buyerCategory("10402"), "plant-based");
    assert.equal(buyerCategory("10590"), "eggs");
    assert.equal(buyerCategory("10500"), "fats");
    assert.equal(buyerCategory("10602"), "cheese");
    // Frozen fish is fish and frozen berries are berries: storage is an attribute, not a category.
    assert.equal(buyerCategory("41720"), "fish");
    assert.equal(buyerCategory("41740"), "fruit-berries");
    assert.equal(buyerCategory("17431"), "vegetables");
    assert.equal(buyerCategory("63100"), "non-food");
    assert.equal(buyerCategory("99999"), "other");
  });

  it("reads one item's contents from its name", () => {
    assert.deepEqual(parseNameSize("Valio Eila® semi skimmed milk drink 10 l novobox"), { contents: { amount: 10, unit: "litre" }, multipack: false });
    assert.deepEqual(parseNameSize("Valio coffee milk 5 dl lactose free")?.contents, { amount: 0.5, unit: "litre" });
    assert.deepEqual(parseNameSize("Arla Portion milk 100x2 cl lactose free")?.contents, { amount: 2, unit: "litre" });
    assert.deepEqual(parseNameSize("Valio Oltermanni® e270 g sliced")?.contents, { amount: 0.27, unit: "kilogram" });
    // A leading "12 x" or an inline "6x 1,4 kg" names the whole case.
    assert.deepEqual(parseNameSize("12 x Arla Whole milk drink 1 L UHT"), { contents: { amount: 12, unit: "litre" }, multipack: true });
    assert.deepEqual(parseNameSize("HK Beef Liver minced frozen 6x 1,4 kg"), { contents: { amount: 8.4, unit: "kilogram" }, multipack: true });
    // A total after a slash describes the sales unit; gross and drained weight keep the first.
    assert.deepEqual(parseNameSize("Lagerblad Foods Meatball 16 g/ 5,2 kg fried")?.contents, { amount: 5.2, unit: "kilogram" });
    assert.deepEqual(parseNameSize("OLIVES PITTED GREEN 3/1,45KG")?.contents, { amount: 3, unit: "kilogram" });
    assert.equal(parseNameSize("TOMATO 2 CLASS FINLAND"), undefined);
  });

  it("multiplies through the pack hierarchy unless the name already describes the case", () => {
    const novobox = [{ unitId: "KI", sizeInBaseUnits: 2 }, { unitId: "ST", sizeInBaseUnits: 1 }];
    assert.deepEqual(salesUnitContents(["Valio Eila® semi skimmed milk drink 10 l novobox"], "KI", novobox), { amount: 20, unit: "litre" });
    const twelve = [{ unitId: "KI", sizeInBaseUnits: 12 }, { unitId: "ST", sizeInBaseUnits: 1 }];
    assert.deepEqual(salesUnitContents(["12 x Arla Whole milk drink 1 L UHT"], "KI", twelve), { amount: 12, unit: "litre" });
    // Products sold by the kilogram contain one kilogram, whatever the name says.
    assert.deepEqual(salesUnitContents(["SALMON FILLET C-CUT A10KG"], "KG", []), { amount: 1, unit: "kilogram" });
  });

  it("maps labels and GS1 allergen sub-codes to the terms the buyer's rules use", () => {
    assert.equal(labelFromCode("EU_ORGANIC_FARMING"), "eu-organic");
    assert.equal(labelFromCode("GOODS_FROM_FINLAND_BLUE_SWAN"), "finnish-origin");
    assert.equal(labelFromCode("MARINE_STEWARDSHIP_COUNCIL_LABEL"), "msc");
    assert.equal(labelFromCode("warmTemperature"), undefined);
    assert.equal(allergenFromGs1("AM"), "milk");
    assert.equal(allergenFromGs1("ML"), "milk");
    // Wheat, oats, and the tree nuts each have their own code.
    assert.equal(allergenFromGs1("UW"), "gluten");
    assert.equal(allergenFromGs1("GO"), "gluten");
    assert.equal(allergenFromGs1("SH"), "nuts");
    assert.equal(allergenFromGs1("X99"), undefined);
  });
});

describe("reading Valio Aimo's live answers", () => {
  const entry: CatalogEntry = {
    id: "1",
    name: "Test milk 10 l",
    nameFi: "Testimaito 10 l",
    supplier: "Test dairy",
    categoryCode: "10400",
    category: "milk",
    salesUnit: "KI",
    lotSize: 1,
    contents: { amount: 20, unit: "litre" },
    attributes: ["lactose-free"],
    labels: [],
    allergens: ["milk"],
    mayContain: [],
    freeFrom: [],
    allergensDeclared: true,
    substitutes: [],
    description: "",
    descriptionFi: "",
  };
  const price = (value: number, comparison?: number): ValioPrice => ({
    productId: "1",
    quantity: 1,
    catalogPrice: { value, valueWithTax: value * 1.135, validFrom: "", validTo: "", currency: "EUR" },
    ...(comparison ? { comparisonPrice: { value: comparison, valueWithTax: comparison, currency: "EUR" }, comparisonUnit: "L" } : {}),
    tax: { taxRate: 13.5, taxValue: 0 },
    netPriceFound: false,
    error: false,
  });
  const availability = (amount: number | null, model = "Stock", closingTime = "2026-11-15T17:00:00+0200", salesBlock = false): ValioAvailability => ({
    productId: "1",
    closingTime,
    salesBlock,
    logisticModel: model,
    scheduleLines: amount === null ? [] : [{ salesBlock: false, availableAmount: amount, availableDate: "2026-11-16", salesUnit: "KI" }],
  });
  const now = new Date("2026-11-13T22:00:00+0200");
  const read = (p: ValioPrice | undefined, a: ValioAvailability | undefined) => toProduct(entry, p, a, "2026-11-13T22:00:00+0200", now);

  it("tells counted, unknown, unconfirmed, and missing stock apart", () => {
    assert.deepEqual([read(price(31.31), availability(48)).stockStatus, read(price(31.31), availability(48)).availablePackages], ["counted", 48]);
    // 999,999 or more means Valio Aimo does not know the amount, and any quantity can be ordered.
    for (const amount of [999_999, 35_714_285, 9_999_999_999]) {
      const unknown = read(price(31.31), availability(amount));
      assert.deepEqual([unknown.stockStatus, unknown.availablePackages, unknown.unavailableReason], ["unknown", UNLIMITED_PACKAGES, undefined], String(amount));
    }
    assert.equal(read(price(31.31), availability(999_998)).stockStatus, "counted");
    // A supplier's warehouse always reports 999,999: Valio Aimo cannot see the real amount.
    const terminal = read(price(31.31), availability(999_999, "Terminal", "2026-11-14T15:00:00+0200"));
    assert.deepEqual([terminal.stockStatus, terminal.logisticModel, terminal.unavailableReason], ["unconfirmed", "supplier", undefined]);
    assert.equal(read(price(31.31), availability(0)).unavailableReason, "none available for 2026-11-16");
    assert.equal(read(price(31.31), availability(null)).unavailableReason, "Valio Aimo cannot deliver it on any date");
    assert.equal(read(price(31.31), availability(48, "Stock", undefined, true)).unavailableReason, "Valio Aimo has blocked its sales for now");
    assert.equal(read({ ...price(1), error: true }, availability(48)).unavailableReason, "Valio Aimo has no price for it");
  });

  it("reads a fraction below one, such as 0.01 crates, as one sales unit", () => {
    const tiny = read(price(31.31), availability(0.01));
    assert.deepEqual([tiny.stockStatus, tiny.availablePackages, tiny.unavailableReason], ["counted", 1, undefined]);
    assert.equal(read(price(31.31), availability(2.5)).availablePackages, 2);
  });

  it("treats an empty amount as not available", () => {
    const empty: ValioAvailability = {
      ...availability(48),
      scheduleLines: [{ salesBlock: false, availableAmount: null as unknown as number, availableDate: "2026-11-16", salesUnit: "KI" }],
    };
    const product = read(price(31.31), empty);
    assert.deepEqual([product.availablePackages, product.unavailableReason], [0, "none available for 2026-11-16"]);
  });

  it("refuses a delivery date whose order cut-off has passed, and says when it was", () => {
    const late = read(price(31.31), availability(999_999, "Terminal", "2026-11-12T15:00:00+0200"));
    assert.equal(late.cutoffPassed, true);
    assert.equal(late.availablePackages, 0);
    assert.equal(late.unavailableReason, "the order cut-off for delivery on 2026-11-16 was Thursday 12 November at 15:00");
  });

  it("takes the contents from Valio Aimo's price per litre when the name disagrees", () => {
    assert.deepEqual(read(price(31.31, 1.57), availability(48)).packageSize, { amount: 20, unit: "litre" });
    const corrected = read(price(31.31, 3.13), availability(48));
    assert.deepEqual([corrected.packageSize, corrected.packageSizeSource], [{ amount: 10, unit: "litre" }, "comparison price"]);
    assert.equal(read(price(31.31, 1.57), availability(48)).pricePerPackageEurCents, 3131);
  });
});

describe("GET /api/products", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it("returns valid products, each with a signed offer and the source of its live data", async () => {
    const { status, body } = await server.request("GET", "/api/products?category=milk");
    assert.equal(status, 200);
    assert.equal(body.products.length, 20);
    assert.equal(body.source.system, "Valio Aimo product data, with the price and availability APIs");
    assert.equal(body.source.productsQueried, 20);
    for (const { availableQuantity, allergenStatements, offer, ...product } of body.products) {
      assert.match(offer.token, /^[\w-]+\.[\w-]+\.[\w-]+$/, product.id);
      assert.ok(productSchema.safeParse(product).success, product.id);
      assert.equal(allergenStatements.length, product.allergens.length + product.mayContain.length + product.freeFrom.length);
      if (availableQuantity) assert.equal(availableQuantity.unit, product.packageSize.unit);
    }
  });

  it("describes the brief's lactose-free milk with Valio Aimo's live price and stock", async () => {
    const { body } = await server.request("GET", "/api/products/464306");
    const milk = body.product;
    assert.equal(milk.name, "Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free");
    assert.equal(milk.nameFi, "Valio Hyvä suomalainen Arki® Eila® kevytmaitojuoma 1 l laktoositon");
    assert.deepEqual(milk.packageSize, { amount: 1, unit: "litre" });
    assert.equal(milk.salesUnit, "ST");
    assert.equal(milk.pricePerPackageEurCents, 101);
    assert.equal(milk.vatRatePercent, 13.5);
    assert.equal(milk.stockStatus, "unknown");
    assert.equal(milk.availableQuantity, null);
    assert.equal(milk.deliveryDate, "2026-11-16");
    assert.equal(milk.orderCutoff, "2026-11-15T17:00:00+0200");
    assert.equal(milk.deliveryReliability, 1);
    assert.ok(milk.attributes.includes("lactose-free"));
  });

  it("keeps the allergen trap: every lactose-free milk still contains milk", async () => {
    const { body } = await server.request("GET", "/api/products?category=milk&attributes=lactose-free&limit=50");
    assert.ok(body.products.length > 5);
    for (const product of body.products) assert.ok(product.allergens.includes("milk"), product.id);
  });

  it("returns 404 for an unknown product", async () => {
    const { status, body } = await server.request("GET", "/api/products/caviar");
    assert.equal(status, 404);
    assert.equal(body.error, "Product not found");
  });
});
