/**
 * How Valio Aimo's product data maps onto the terms the buyer's rules use:
 * buyer categories, labels, the 14 EU allergens, dietary attributes, and the
 * contents of one sales unit. The catalog build and the tests share these
 * rules, so they live in one place.
 */

/** Categories a buyer can read, grouped by what the product is, not how it is stored. */
export const BUYER_CATEGORIES = [
  "milk",
  "cream",
  "plant-based",
  "yoghurt",
  "desserts",
  "fats",
  "eggs",
  "cheese",
  "meat",
  "fish",
  "vegetables",
  "fruit-berries",
  "bakery",
  "ready-meals",
  "pantry",
  "drinks",
  "sweets-snacks",
  "non-food",
  "other",
] as const;

export type BuyerCategory = (typeof BUYER_CATEGORIES)[number];

/**
 * Category code prefixes, most specific first. The codes come without names,
 * so the table was built by reading the product names in each code.
 */
const CATEGORY_PREFIXES: [prefix: string, category: BuyerCategory][] = [
  ["10400", "milk"],
  ["10404", "milk"],
  ["10405", "milk"],
  ["10401", "cream"],
  ["10419", "cream"],
  ["10402", "plant-based"],
  ["10406", "plant-based"],
  ["10413", "plant-based"],
  ["10418", "plant-based"],
  ["10641", "plant-based"],
  ["10411", "yoghurt"],
  ["10412", "yoghurt"],
  ["1043", "desserts"],
  ["418", "desserts"],
  ["1059", "eggs"],
  ["105", "fats"],
  ["106", "cheese"],
  ["41771", "cheese"],
  ["172", "meat"],
  ["1871", "meat"],
  ["1872", "meat"],
  ["1873", "meat"],
  ["1874", "meat"],
  ["1875", "meat"],
  ["1876", "meat"],
  ["4170", "meat"],
  ["4171", "meat"],
  ["1870", "fish"],
  ["4172", "fish"],
  ["1741", "fruit-berries"],
  ["17445", "fruit-berries"],
  ["17481", "fruit-berries"],
  ["4174", "fruit-berries"],
  ["174", "vegetables"],
  ["4173", "vegetables"],
  ["4175", "ready-meals"],
  ["173", "ready-meals"],
  ["216", "ready-meals"],
  ["4176", "bakery"],
  ["109", "bakery"],
  ["110", "bakery"],
  ["211", "bakery"],
  ["212", "bakery"],
  ["213", "pantry"],
  ["214", "pantry"],
  ["215", "pantry"],
  ["219", "pantry"],
  ["221", "pantry"],
  ["226", "pantry"],
  ["223", "drinks"],
  ["224", "drinks"],
  ["225", "drinks"],
  ["227", "drinks"],
  ["849", "drinks"],
  ["850", "drinks"],
  ["522", "sweets-snacks"],
  ["200", "non-food"],
  ["300", "non-food"],
  ["329", "non-food"],
  ["63", "non-food"],
  ["64", "non-food"],
  ["67", "non-food"],
  ["777", "non-food"],
  ["900", "non-food"],
];

/**
 * Unprocessed fresh produce rarely carries an allergen declaration: loose
 * vegetables, fruit, fresh fish and meat cuts, and eggs. The buyer's rules
 * accept a missing declaration in these categories; anywhere else, a product
 * without one cannot be shown to be free of an allergen and goes to a person.
 * This is an assumption, stated in the docs, that a buyer could change.
 */
export const FRESH_PRODUCE: readonly BuyerCategory[] = ["vegetables", "fruit-berries", "fish", "meat", "eggs"];

/** True when a missing allergen declaration is accepted for this category. */
export const acceptsUndeclared = (category: BuyerCategory) => FRESH_PRODUCE.includes(category);

export function buyerCategory(code: string): BuyerCategory {
  return CATEGORY_PREFIXES.find(([prefix]) => code.startsWith(prefix))?.[1] ?? "other";
}

/** Labels shown in the webshop, as the buyer's rules name them. */
export const LABELS = [
  "eu-organic",
  "msc",
  "asc",
  "fairtrade",
  "rainforest-alliance",
  "nordic-swan",
  "eu-ecolabel",
  "krav",
  "finnish-origin",
  "heart-symbol",
] as const;

export type ProductLabel = (typeof LABELS)[number];

const LABEL_CODES: Record<string, ProductLabel> = {
  EU_ORGANIC_FARMING: "eu-organic",
  SOIL_ASSOCIATION_ORGANIC_SYMBOL: "eu-organic",
  MARINE_STEWARDSHIP_COUNCIL_LABEL: "msc",
  AQUACULTURE_STEWARDSHIP_COUNCIL: "asc",
  FAIR_TRADE_MARK: "fairtrade",
  RAINFOREST_ALLIANCE: "rainforest-alliance",
  UTZ_CERTIFIED: "rainforest-alliance",
  SVANEN: "nordic-swan",
  EU_ECO_LABEL: "eu-ecolabel",
  KRAV_MARK: "krav",
  GOODS_FROM_FINLAND_BLUE_SWAN: "finnish-origin",
  MADE_IN_FINLAND_FLAG_WITH_KEY: "finnish-origin",
  PUHTAASTI_KOTIMAINEN: "finnish-origin",
  FINNISH_HEART_SYMBOL: "heart-symbol",
};

export const labelFromCode = (code: string): ProductLabel | undefined => LABEL_CODES[code];

/** Storage temperature from the package marks. */
export const TEMPERATURE_CODES: Record<string, "frozen" | "chilled" | "ambient"> = {
  freezeTemperature: "frozen",
  coolTemperature: "chilled",
  warmTemperature: "ambient",
};

/** The 14 allergens EU Regulation 1169/2011 requires food businesses to declare. */
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soy",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type EuAllergen = (typeof ALLERGENS)[number];

/** The main GS1 allergen type code for each of the 14. */
export const GS1_ALLERGEN_CODES = {
  gluten: "AW",
  crustaceans: "AC",
  eggs: "AE",
  fish: "AF",
  peanuts: "AP",
  soy: "AY",
  milk: "AM",
  nuts: "AN",
  celery: "BC",
  mustard: "BM",
  sesame: "AS",
  sulphites: "AU",
  lupin: "NL",
  molluscs: "UM",
} as const satisfies Record<EuAllergen, string>;

/**
 * Every GS1 allergen type code in the data that names one of the 14, including
 * the sub-codes: wheat, rye, barley, oats, spelt, and kamut are cereals
 * containing gluten, the tree nuts each have a code, and lactose is a milk
 * ingredient. Codes outside the 14 are left out.
 */
const GS1_CODE_ALLERGENS: Record<string, EuAllergen> = {
  ...Object.fromEntries(Object.entries(GS1_ALLERGEN_CODES).map(([allergen, code]) => [code, allergen])),
  UW: "gluten",
  NR: "gluten",
  GB: "gluten",
  GO: "gluten",
  GS: "gluten",
  GK: "gluten",
  SA: "nuts",
  SC: "nuts",
  SH: "nuts",
  SM: "nuts",
  SP: "nuts",
  SQ: "nuts",
  SR: "nuts",
  ST: "nuts",
  SW: "nuts",
  ML: "milk",
};

export const allergenFromGs1 = (code: string): EuAllergen | undefined => GS1_CODE_ALLERGENS[code];

/** Dietary attributes from the manufacturer's nutritional claims. */
const CLAIM_ATTRIBUTES: Record<string, string> = {
  FREE_FROM_LACTOSE: "lactose-free",
  LOW_LACTOSE: "low-lactose",
  FREE_FROM_GLUTEN: "gluten-free",
  VEGAN: "vegan",
  VEGETARIAN: "vegetarian",
  FREE_FROM_EGGS: "egg-free",
  FREE_FROM_SOY: "soy-free",
  NO_ADDED_SUGARS: "no-added-sugar",
  HIGH_PROTEIN: "high-protein",
  HIGH_FIBRE: "high-fibre",
  LOW_FAT: "low-fat",
};

export const attributeFromClaim = (code: string): string | undefined => CLAIM_ATTRIBUTES[code];

export type ContentsUnit = "litre" | "kilogram" | "piece";

export interface Contents {
  amount: number;
  unit: ContentsUnit;
}

const UNIT_FACTORS: Record<string, [ContentsUnit, number]> = {
  l: ["litre", 1],
  ltr: ["litre", 1],
  dl: ["litre", 0.1],
  cl: ["litre", 0.01],
  ml: ["litre", 0.001],
  kg: ["kilogram", 1],
  g: ["kilogram", 0.001],
  gr: ["kilogram", 0.001],
  kpl: ["piece", 1],
  pcs: ["piece", 1],
  pc: ["piece", 1],
};

const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const UNIT = String.raw`(kg|g|gr|ltr|l|dl|cl|ml|kpl|pcs|pc)`;
const num = (text: string) => Number(text.replace(",", "."));
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The amount one item named like this contains, read from its name, such as
 * "10 l", "2,5 dl", "100x2 cl", "6x2,5kg", "e270 g", or "1680/800g" (gross
 * and drained weight, of which the first counts). A leading "12 x" means the
 * name describes a multipack.
 */
export function parseNameSize(name: string): { contents: Contents; multipack: boolean } | undefined {
  const text = name.toLowerCase().replace(/ /g, " ");
  const leading = new RegExp(String.raw`^(\d+)\s*x\s+`).exec(text);
  const multiplier = leading ? Number(leading[1]) : 1;
  // A total after a slash, as in "16 g/ 5,2 kg" or "2,5 kg x 2 / 5 kg", describes the whole sales unit.
  const total = new RegExp(String.raw`(?:(${NUMBER})\s*${UNIT}|x\s*\d+)\s*/\s*(${NUMBER})\s*${UNIT}(?![a-z])`).exec(text);
  if (total) {
    const [unit, factor] = UNIT_FACTORS[total[4]!]!;
    const amount = num(total[3]!) * factor;
    const [firstUnit, firstFactor] = total[2] ? UNIT_FACTORS[total[2]]! : [unit, 0];
    const before = total[1] ? num(total[1]) * firstFactor : 0;
    // "3/1,45 kg" is gross and drained weight; a total is larger than what comes before it.
    if (firstUnit === unit && amount > before) return { contents: { amount: round(amount), unit }, multipack: true };
  }
  const patterns = [
    new RegExp(String.raw`(?<![\d.,])(\d+)\s*x\s*(${NUMBER})\s*${UNIT}(?![a-z])`),
    new RegExp(String.raw`(?<![\d.,])(${NUMBER})\s*/\s*${NUMBER}\s*${UNIT}(?![a-z])`),
    new RegExp(String.raw`(?<![\d.,])(${NUMBER})\s*${UNIT}(?![a-z])`),
  ];
  for (const [index, pattern] of patterns.entries()) {
    const match = pattern.exec(text);
    if (!match) continue;
    const [count, amount, unitText] = index === 0 ? [num(match[1]!), num(match[2]!), match[3]!] : [1, num(match[1]!), match[2]!];
    const [unit, factor] = UNIT_FACTORS[unitText]!;
    if (amount <= 0) continue;
    // "6x 1,4 kg" or "8x280ml" names the whole case, like a leading "12 x".
    return { contents: { amount: round(multiplier * count * amount * factor), unit }, multipack: leading !== null || index === 0 };
  }
  return undefined;
}

export interface UnitSize {
  unitId: string;
  sizeInBaseUnits: number;
}

/**
 * The contents of one sales unit. Products sold by the kilogram contain one
 * kilogram. Otherwise the name gives the size, and the pack hierarchy says how
 * many named items one sales unit holds, unless the name already describes a
 * multipack. Undefined when the name gives no size.
 */
export function salesUnitContents(names: string[], salesUnit: string, units: UnitSize[]): Contents | undefined {
  if (salesUnit === "KG") return { amount: 1, unit: "kilogram" };
  for (const name of names) {
    const parsed = parseNameSize(name);
    if (!parsed) continue;
    if (parsed.multipack) return parsed.contents;
    const salesSize = units.find((unit) => unit.unitId === salesUnit)?.sizeInBaseUnits ?? 1;
    const smallest = Math.min(...units.map((unit) => unit.sizeInBaseUnits).filter((size) => size > 0), 1);
    const items = salesSize / smallest;
    return { amount: round(parsed.contents.amount * items), unit: parsed.contents.unit };
  }
  return undefined;
}

/**
 * Words that say nothing about what a product is: units and packaging,
 * countries, storage, marketing, and dietary claims, which are attributes.
 */
const GENERIC_WORDS = new Set(
  (
    "l dl cl ml kg g gr ltr pcs pc kpl st x uht esl box bag case crate sack block tray pack cans cartons carton bib tetra novobox bottle loose punnet bunch " +
    "frozen chilled washed class approx appr ca the and with for of in ja new uusi original classic premium hyvä suomalainen arki " +
    "finland finnish suomi suomesta fi nl es ma fr be de se it pl eu ee norway sweden denmark spain italy netherlands " +
    "organic luomu lactose laktoositon free gluten gluteeniton low vegan vegaaninen red green yellow white black orange purple"
  ).split(" "),
);

/** The words of a product name that say what it is, without its brand or generic words. */
export function productWords(name: string, brand?: string): Set<string> {
  const brandWords = new Set((brand ?? "").toLowerCase().split(/[^a-zäöå0-9]+/).filter(Boolean));
  return new Set(
    name
      .toLowerCase()
      .split(/[^a-zäöå]+/)
      .filter((word) => word.length > 2 && !GENERIC_WORDS.has(word) && !brandWords.has(word)),
  );
}

/** Words that name the form of a product: a cooking cream is not replaced by a drink. */
const FORM_WORDS = ["cooking", "cream", "drink", "yoghurt", "yogurt", "gurt", "spread", "sauce", "soup", "powder", "juice", "fraiche", "mousse", "pudding", "quark", "slices", "grated"];

/** The form words in a product's English name. */
export function formWords(name: string): string[] {
  const words = name.toLowerCase().split(/[^a-z]+/);
  return FORM_WORDS.filter((form) => words.includes(form));
}

/** Words two names share. A compound counts, so "cherrytomatoes" shares "tomatoes". */
export function sharedWords(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((word) => b.has(word) || [...b].some((other) => (other.length >= 5 && word.endsWith(other)) || (word.length >= 5 && other.endsWith(word))));
}

/**
 * Proteins a kitchen can swap in a dish: salmon for rainbow trout, but not for
 * herring. Recipe logic for main proteins, kept short and explicit.
 */
const PROTEIN_KINDS: [kind: string, words: string[]][] = [
  ["salmon or trout", ["salmon", "trout", "char", "lohi", "kirjolohi", "nieriä"]],
  ["white fish", ["cod", "saithe", "hake", "haddock", "pollock", "turska", "seiti", "kummeli"]],
  ["herring", ["herring", "sprat", "silakka", "silli", "kilohaili"]],
  ["poultry", ["chicken", "turkey", "broiler", "poultry", "kana", "broileri", "kalkkuna"]],
  ["beef", ["beef", "nauta", "härkä"]],
  ["pork", ["pork", "porsas", "sika", "possu"]],
  ["lamb", ["lamb", "lammas"]],
  ["reindeer", ["reindeer", "poro"]],
];

/** The kind of protein a product is, by its name, or undefined. */
export function proteinKind(name: string): string | undefined {
  const words = name.toLowerCase().split(/[^a-zäöå]+/);
  return PROTEIN_KINDS.find(([, kindWords]) => kindWords.some((word) => words.includes(word)))?.[0];
}
