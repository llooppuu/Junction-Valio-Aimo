import { getLanguage } from "./i18n";

/**
 * Finnish names for products, dishes, roles, attributes, and the kitchens.
 * The server keeps its own texts in English, so the audit trail and the agents
 * read one language; the interface shows these names when Finnish is selected
 * and falls back to the server's text for anything not listed.
 */

/**
 * Finnish product names and texts come from Valio Aimo's own data. Every
 * product the app fetches is remembered here, so quotes, alerts, and
 * suggestions that name a product by its code show it in Finnish too.
 */
const PRODUCT_NAMES = new Map<string, string>();
const PRODUCT_DESCRIPTIONS = new Map<string, string>();

export function rememberProducts(products: { id: string; nameFi?: string; descriptionFi?: string }[]) {
  for (const product of products) {
    if (product.nameFi) PRODUCT_NAMES.set(product.id, product.nameFi);
    if (product.descriptionFi) PRODUCT_DESCRIPTIONS.set(product.id, product.descriptionFi);
  }
}

/** The sales agent's pitches in Finnish, by product code. */
const PITCHES: Record<string, string> = {
  "473629": "Syksyn pakastepuolukat ovat tulleet: sopivat puuroon, riistalle ja joulumenuihin, ja niitä on varastossa ensi viikoksi.",
  "463472": "Uutuus hyllyssämme: Valio PROfeel -vaniljaproteiinirahka, laktoositon, aamiaisbuffetiin ja aktiivisille vieraille.",
  "460685": "Joulu tulee: Fazer Geisha -hasselpähkinäsuklaa 3 kg:n suurtalouspakkauksessa buffetiin ja kahvipöytään.",
};

const DISHES: Record<string, string> = {
  "Roasted beetroot soup with oat cream": "Paahdettu punajuurikeitto ja kaurakerma",
  "Roast tomato pasta sauce": "Paahdettu tomaattipastakastike",
  "Garden salad with cherry tomatoes and Emmental": "Puutarhasalaatti, kirsikkatomaatit ja emmental",
  "Salmon with beetroot and butter sauce": "Lohta, punajuurta ja voikastiketta",
  "Fried Baltic herring with mash": "Paistetut silakat ja perunamuusi",
  "Milk-free oven pancakes": "Maidoton pannukakku",
};

const ROLES: Record<string, string> = {
  "sauce base": "kastikepohja",
  "soup base": "keittopohja",
  "salad garnish": "salaatin koriste",
  "salad topping": "salaatin täyte",
  "main protein": "pääproteiini",
  "side vegetable": "lisäkevihannes",
  "cooking fat": "paistorasva",
  "finishing cream": "viimeistelykerma",
  "batter base": "taikinapohja",
  "batter liquid": "taikinaneste",
  binding: "sidosaine",
  coating: "jauhotus",
  "mash liquid": "muusin neste",
};

const ATTRIBUTES: Record<string, string> = {
  "lactose-free": "laktoositon",
  "low-lactose": "vähälaktoosinen",
  "milk-free": "maidoton",
  "gluten-free": "gluteeniton",
  vegan: "vegaaninen",
  vegetarian: "kasvis",
  "egg-free": "kananmunaton",
  "soy-free": "soijaton",
  "no-added-sugar": "ei lisättyä sokeria",
  "high-protein": "runsasproteiininen",
  "high-fibre": "runsaskuituinen",
  "low-fat": "vähärasvainen",
  organic: "luomu",
  chilled: "kylmäsäilytys",
  ambient: "huoneenlämpö",
  frozen: "pakaste",
};

/** People, kitchens, and planned orders, by the server's English name. */
const PEOPLE: Record<string, string> = {
  "Hotel chain": "Hotelliketju",
  "School kitchen": "Koulukeittiö",
  "Hotel chain purchasing agent": "Hotelliketjun ostoagentti",
  "School kitchen purchasing agent": "Koulukeittiön ostoagentti",
  "Head chef": "Keittiöpäällikkö",
  "Wholesaler operations": "Tukkurin operatiivinen tiimi",
  "Weekly kitchen order": "Keittiön viikkotilaus",
  "Weekly school kitchen order": "Koulukeittiön viikkotilaus",
};

const finnish = (table: Record<string, string> | Map<string, string>, key: string, fallback: string) =>
  getLanguage() === "fi" ? ((table instanceof Map ? table.get(key) : table[key]) ?? fallback) : fallback;

export const productName = (id: string, fallback: string) => finnish(PRODUCT_NAMES, id, fallback);
export const productDescription = (id: string, fallback: string) => finnish(PRODUCT_DESCRIPTIONS, id, fallback);
export const dishName = (name: string) => finnish(DISHES, name, name);
export const roleName = (role: string) => finnish(ROLES, role, role);
export const attributeName = (attribute: string) => finnish(ATTRIBUTES, attribute, attribute);
export const personName = (name: string) => finnish(PEOPLE, name, name);
export const pitchText = (productId: string, fallback: string) => finnish(PITCHES, productId, fallback);
