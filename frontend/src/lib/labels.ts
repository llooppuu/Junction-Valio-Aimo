import type { Allergen, Label, ProductCategory } from "./api";
import { getLanguage, type Language } from "./i18n";

type Names<K extends string> = Record<Language, Record<K, string>>;

const LABEL_NAMES: Names<Label> = {
  en: {
    "eu-organic": "EU organic",
    msc: "MSC certified",
    asc: "ASC certified",
    fairtrade: "Fairtrade",
    "rainforest-alliance": "Rainforest Alliance",
    "nordic-swan": "Nordic Swan Ecolabel",
    "eu-ecolabel": "EU Ecolabel",
    krav: "KRAV",
    "finnish-origin": "Finnish origin",
    "heart-symbol": "Heart symbol",
  },
  fi: {
    "eu-organic": "EU-luomu",
    msc: "MSC-sertifioitu",
    asc: "ASC-sertifioitu",
    fairtrade: "Reilu kauppa",
    "rainforest-alliance": "Rainforest Alliance",
    "nordic-swan": "Joutsenmerkki",
    "eu-ecolabel": "EU-ympäristömerkki",
    krav: "KRAV",
    "finnish-origin": "Suomalainen alkuperä",
    "heart-symbol": "Sydänmerkki",
  },
};

const LABEL_DESCRIPTIONS: Names<Label> = {
  en: {
    "eu-organic": "Produced to the EU organic regulation",
    msc: "Wild seafood from a fishery certified by the Marine Stewardship Council",
    asc: "Farmed seafood certified by the Aquaculture Stewardship Council",
    fairtrade: "Fairtrade certified",
    "rainforest-alliance": "Grown on farms certified by the Rainforest Alliance",
    "nordic-swan": "Meets the Nordic Swan Ecolabel's environmental criteria",
    "eu-ecolabel": "Meets the EU Ecolabel's environmental criteria",
    krav: "Swedish organic certification",
    "finnish-origin": "The Blue Swan or the flag with key: made in Finland",
    "heart-symbol": "A better choice for salt, fat, and fibre in its product group",
  },
  fi: {
    "eu-organic": "Tuotettu EU:n luomuasetuksen mukaisesti",
    msc: "Luonnonvarainen merenelävä Marine Stewardship Councilin sertifioimalta kalastukselta",
    asc: "Aquaculture Stewardship Councilin sertifioima kasvatettu merenelävä",
    fairtrade: "Reilun kaupan sertifioima",
    "rainforest-alliance": "Viljelty Rainforest Alliancen sertifioimilla tiloilla",
    "nordic-swan": "Täyttää Joutsenmerkin ympäristökriteerit",
    "eu-ecolabel": "Täyttää EU-ympäristömerkin kriteerit",
    krav: "Ruotsalainen luomusertifiointi",
    "finnish-origin": "Hyvää Suomesta -merkki tai avainlippu: valmistettu Suomessa",
    "heart-symbol": "Parempi valinta suolan, rasvan ja kuidun osalta tuoteryhmässään",
  },
};

const ALLERGEN_NAMES: Names<Allergen> = {
  en: {
    gluten: "Gluten",
    crustaceans: "Crustaceans",
    eggs: "Eggs",
    fish: "Fish",
    peanuts: "Peanuts",
    soy: "Soy",
    milk: "Milk",
    nuts: "Tree nuts",
    celery: "Celery",
    mustard: "Mustard",
    sesame: "Sesame",
    sulphites: "Sulphites",
    lupin: "Lupin",
    molluscs: "Molluscs",
  },
  fi: {
    gluten: "Gluteeni",
    crustaceans: "Äyriäiset",
    eggs: "Kananmuna",
    fish: "Kala",
    peanuts: "Maapähkinä",
    soy: "Soija",
    milk: "Maito",
    nuts: "Pähkinät",
    celery: "Selleri",
    mustard: "Sinappi",
    sesame: "Seesami",
    sulphites: "Sulfiitit",
    lupin: "Lupiini",
    molluscs: "Nilviäiset",
  },
};

const CATEGORY_NAMES: Names<ProductCategory> = {
  en: {
    milk: "Milk",
    cream: "Cream",
    "plant-based": "Plant-based alternatives",
    yoghurt: "Yoghurt and sour milk",
    desserts: "Desserts and ice cream",
    fats: "Butter, fats, and oils",
    eggs: "Eggs",
    cheese: "Cheese",
    meat: "Meat and poultry",
    fish: "Fish and seafood",
    vegetables: "Vegetables",
    "fruit-berries": "Fruit and berries",
    bakery: "Bakery",
    "ready-meals": "Ready meals and salads",
    pantry: "Pantry",
    drinks: "Drinks",
    "sweets-snacks": "Sweets and snacks",
    "non-food": "Non-food",
    other: "Other",
  },
  fi: {
    milk: "Maito",
    cream: "Kerma",
    "plant-based": "Kasvipohjaiset vaihtoehdot",
    yoghurt: "Jogurtit ja viilit",
    desserts: "Jälkiruoat ja jäätelöt",
    fats: "Voi, rasvat ja öljyt",
    eggs: "Kananmunat",
    cheese: "Juustot",
    meat: "Liha ja siipikarja",
    fish: "Kala ja äyriäiset",
    vegetables: "Vihannekset",
    "fruit-berries": "Hedelmät ja marjat",
    bakery: "Leipomotuotteet",
    "ready-meals": "Valmisruoat ja salaatit",
    pantry: "Kuivatuotteet",
    drinks: "Juomat",
    "sweets-snacks": "Makeiset ja naposteltavat",
    "non-food": "Muut kuin elintarvikkeet",
    other: "Muut",
  },
};

/** GS1 allergen type codes, as the API's allergenStatements use them. */
export const GS1_CODES: Record<Allergen, string> = {
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
};

export const LABELS = Object.keys(LABEL_NAMES.en) as Label[];
export const ALLERGENS = Object.keys(ALLERGEN_NAMES.en) as Allergen[];
export const CATEGORIES = Object.keys(CATEGORY_NAMES.en) as ProductCategory[];

export const labelName = (label: Label) => LABEL_NAMES[getLanguage()][label];
export const labelDescription = (label: Label) => LABEL_DESCRIPTIONS[getLanguage()][label];
export const allergenName = (allergen: Allergen) => ALLERGEN_NAMES[getLanguage()][allergen];
export const categoryName = (category: ProductCategory) => CATEGORY_NAMES[getLanguage()][category];

const countryNames = { en: new Intl.DisplayNames(["en-GB"], { type: "region" }), fi: new Intl.DisplayNames(["fi-FI"], { type: "region" }) };

export function countryName(code: string): string {
  return countryNames[getLanguage()].of(code) ?? code;
}
