import type { Allergen, Label, ProductCategory } from "./schemas/product.js";

/**
 * Finnish for the sentences the server writes itself: the audit history,
 * guardrail checks, stock alerts, and suggestions. Each carries an English and
 * a Finnish version, so the interface shows whichever language the buyer reads.
 */

/** Text the server writes for people, in both of the interface's languages. */
export interface Finnish {
  summary: string;
  reason?: string;
}

const EURO_FI = new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR" });

/** 1 010,00 € */
export function fiEur(cents: number): string {
  // Intl uses a narrow no-break space as the thousands separator; a plain space reads the same everywhere.
  return EURO_FI.format(cents / 100).replace(/ | /g, " ");
}

/** 2026-11-16 → 16.11.2026 */
export function fiDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return year && month && day ? `${Number(day)}.${Number(month)}.${year}` : isoDate;
}

/** a, b ja c */
export function fiList(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} ja ${items.at(-1)}`;
}

const WEEKDAY_FI = new Intl.DateTimeFormat("fi-FI", { timeZone: "Europe/Helsinki", weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

/** A cut-off time, such as "torstaina 12.11. klo 15.00". */
export function fiDescribeTime(iso: string): string {
  const parts = Object.fromEntries(WEEKDAY_FI.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.weekday}na ${parts.day}.${parts.month}. klo ${parts.hour}.${parts.minute}`;
}

/** Product categories in Finnish, the same names the interface uses. */
export const CATEGORY_FI: Record<ProductCategory, string> = {
  milk: "maito",
  cream: "kerma",
  "plant-based": "kasvipohjaiset vaihtoehdot",
  yoghurt: "jogurtit ja viilit",
  desserts: "jälkiruoat ja jäätelöt",
  fats: "voi, rasvat ja öljyt",
  eggs: "kananmunat",
  cheese: "juustot",
  meat: "liha ja siipikarja",
  fish: "kala ja äyriäiset",
  vegetables: "vihannekset",
  "fruit-berries": "hedelmät ja marjat",
  bakery: "leipomotuotteet",
  "ready-meals": "valmisruoat ja salaatit",
  pantry: "kuivatuotteet",
  drinks: "juomat",
  "sweets-snacks": "makeiset ja naposteltavat",
  "non-food": "muut kuin elintarvikkeet",
  other: "muut",
};

/** The 14 EU allergens in Finnish. */
export const ALLERGEN_FI: Record<Allergen, string> = {
  gluten: "gluteeni",
  crustaceans: "äyriäiset",
  eggs: "kananmuna",
  fish: "kala",
  peanuts: "maapähkinä",
  soy: "soija",
  milk: "maito",
  nuts: "pähkinät",
  celery: "selleri",
  mustard: "sinappi",
  sesame: "seesami",
  sulphites: "sulfiitit",
  lupin: "lupiini",
  molluscs: "nilviäiset",
};

/** Product labels in Finnish, the same names the interface uses. */
export const LABEL_FI: Record<Label, string> = {
  "eu-organic": "EU-luomu",
  msc: "MSC-sertifioitu",
  asc: "ASC-sertifioitu",
  fairtrade: "Reilu kauppa",
  "rainforest-alliance": "Rainforest Alliance",
  "nordic-swan": "Joutsenmerkki",
  "eu-ecolabel": "EU-ympäristömerkki",
  krav: "KRAV",
  "finnish-origin": "suomalainen alkuperä",
  "heart-symbol": "Sydänmerkki",
};

/** The buyer names the kitchens use, in Finnish. */
const BUYER_FI: Record<string, string> = { "Hotel chain": "Hotelliketju", "School kitchen": "Koulukeittiö" };
export const fiBuyer = (name: string) => BUYER_FI[name] ?? name;

/** The agents' and people's names, in Finnish. */
const PERSON_FI: Record<string, string> = {
  "Hotel chain purchasing agent": "Hotelliketjun ostoagentti",
  "School kitchen purchasing agent": "Koulukeittiön ostoagentti",
  "Head chef": "Keittiöpäällikkö",
  "Wholesaler operations": "Tukkurin operatiivinen tiimi",
};
export const fiPerson = (name: string) => PERSON_FI[name] ?? name;

/** The catalog's short reasons, such as "not lactose-free" or "contains milk", in Finnish. */
export function requirementFi(text: string): string {
  const date = (iso: string) => fiDate(iso);
  let match: RegExpExecArray | null;
  if ((match = /^not (.+)$/.exec(text))) return `ei ${ATTRIBUTE_FI[match[1]!] ?? match[1]}`;
  if ((match = /^no (.+) label$/.exec(text))) return `ei merkintää ${LABEL_FI[match[1] as Label] ?? match[1]}`;
  if ((match = /^contains (\w+)$/.exec(text))) return `sisältää: ${ALLERGEN_FI[match[1] as Allergen] ?? match[1]}`;
  if ((match = /^may contain (\w+)$/.exec(text))) return `voi sisältää: ${ALLERGEN_FI[match[1] as Allergen] ?? match[1]}`;
  if (text === "allergens not declared by the manufacturer") return "valmistaja ei ole ilmoittanut allergeeneja";
  if ((match = /^delivers (\d{4}-\d{2}-\d{2}), after the (\d{4}-\d{2}-\d{2}) deadline$/.exec(text))) return `toimitus ${date(match[1]!)}, määräajan ${date(match[2]!)} jälkeen`;
  if (text === "Valio Aimo cannot deliver it on any date") return "Valio Aimo ei voi toimittaa sitä millekään päivälle";
  if (text === "Valio Aimo has blocked its sales for now") return "Valio Aimo on toistaiseksi estänyt sen myynnin";
  if (text === "Valio Aimo has no price for it") return "Valio Aimolla ei ole sille hintaa";
  if (text === "Valio Aimo did not report its availability") return "Valio Aimo ei ilmoittanut sen saatavuutta";
  if ((match = /^none available for (\d{4}-\d{2}-\d{2})$/.exec(text))) return `ei saatavilla ${date(match[1]!)}`;
  if (text === "none available") return "ei saatavilla";
  if ((match = /^the order cut-off for delivery on (\d{4}-\d{2}-\d{2}) was (.+)$/.exec(text))) return `toimitukselle ${date(match[1]!)} tilausaika on päättynyt`;
  if (text === "out of stock") return "loppu varastosta";
  return text;
}

/** Product attributes in Finnish. */
export const ATTRIBUTE_FI: Record<string, string> = {
  "lactose-free": "laktoositon",
  "gluten-free": "gluteeniton",
  "milk-free": "maidoton",
  organic: "luomu",
  vegan: "vegaaninen",
};

/** Quantity units in Finnish. */
const UNIT_FI = { litre: "l", kilogram: "kg", piece: "kpl" } as const;
export function fiQuantity({ amount, unit }: { amount: number; unit: keyof typeof UNIT_FI }): string {
  return `${amount.toLocaleString("fi-FI").replace(/ | /g, " ")} ${UNIT_FI[unit]}`;
}
