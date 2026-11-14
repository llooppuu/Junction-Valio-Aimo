import { z } from "zod";
import { inventoryItemSchema, recipeSchema } from "../schemas/recipe.js";

/**
 * The kitchens' recipes and stock on hand. The recipes are ours; every
 * ingredient names a real product from Valio Aimo's catalog in that product's
 * own unit, chosen because Valio Aimo could deliver it when the scenarios were
 * written. Eggs are sold by weight, so a large egg counts as 0.07 kg.
 *
 * Two ingredients show real exceptions: the kitchens' usual oat cream
 * (Oddlygood Cooking) could not be delivered on any date, and fresh salmon
 * comes in limited amounts. The checks below stop the backend at startup if an
 * ingredient names a product that is not in the catalog.
 */
const per = (amount: number, unit: "litre" | "kilogram" | "piece") => ({ amount, unit });

/** The products the scenarios use, by what they are. */
export const SCENARIO_PRODUCTS = {
  beetroot: "460837", // RED BEETROOT WASHED FINLAND, sold by the kg
  beetrootPeeled: "470912", // VÖRLÖ PEELED BEETROOT 5KG
  choppedTomatoes: "471551", // Gustodoro chopped tomatoes 1 kg
  cherryTomatoes: "462545", // CHERRYTOMATOES 4KG LOOSE
  oatCream: "469094", // Oddlygood Cooking 1 l UHT, case of 10
  oatCreamOatly: "460697", // Oatly iMat for Cooking 1 l
  butter: "464411", // Valio butter 500 g unsalted
  emmental: "476660", // Valio Emmental red label 2.5 kg grated
  eggs: "463982", // Kieku Barn Eggs L180, 12.3 kg
  salmon: "462150", // SALMON FILLET C-CUT, by the kg
  trout: "462016", // RAINBOW TROUT FILLET C, by the kg
  whippingCream: "464194", // Valio whipping cream 1 l UHT lactose free
  herring: "475514", // Fiskano MSC Baltic herring fillet IQF 5 kg
  wheatFlour: "470169", // Myllärin Wheat Flour 20 kg
  wholeMilk: "464073", // Valio whole milk 1 l lactose free UHT
  oatDrink: "468465", // Oddlygood oat drink 1 l UHT gluten free
  oatCookingSchool: "472966", // Oddlygood Cooking Oat 1 l original gluten free
} as const;

const P = SCENARIO_PRODUCTS;

export const recipes = z.array(recipeSchema).parse([
  {
    id: "beetroot-soup",
    name: "Roasted beetroot soup with oat cream",
    kitchens: ["demo-agent", "school-agent"],
    seasons: ["autumn", "winter"],
    description: "A seasonal soup built around new-season Finnish beetroot, finished with a dairy-free oat cream.",
    ingredients: [
      { name: "Beetroot", role: "soup base", category: "vegetables", productId: P.beetroot, quantityPerPortion: per(0.18, "kilogram") },
      { name: "Chopped tomatoes", role: "soup base", category: "pantry", productId: P.choppedTomatoes, quantityPerPortion: per(0.03, "kilogram") },
      { name: "Oat cooking cream", role: "finishing cream", category: "plant-based", productId: P.oatCream, quantityPerPortion: per(0.04, "litre") },
    ],
  },
  {
    id: "tomato-pasta-sauce",
    name: "Roast tomato pasta sauce",
    kitchens: ["demo-agent"],
    seasons: ["spring", "summer", "autumn", "winter"],
    description: "Chopped tomatoes with roasted cherry tomatoes for sweetness, finished with butter.",
    ingredients: [
      { name: "Chopped tomatoes", role: "sauce base", category: "pantry", productId: P.choppedTomatoes, quantityPerPortion: per(0.12, "kilogram") },
      { name: "Cherry tomatoes", role: "sauce base", category: "vegetables", productId: P.cherryTomatoes, quantityPerPortion: per(0.05, "kilogram") },
      { name: "Butter", role: "cooking fat", category: "fats", productId: P.butter, quantityPerPortion: per(0.01, "kilogram") },
    ],
  },
  {
    id: "garden-salad",
    name: "Garden salad with cherry tomatoes and Emmental",
    kitchens: ["demo-agent"],
    seasons: ["spring", "summer", "autumn"],
    description: "Fresh cherry tomatoes as the garnish, with grated Emmental and a boiled egg on top.",
    ingredients: [
      { name: "Cherry tomatoes", role: "salad garnish", category: "vegetables", productId: P.cherryTomatoes, quantityPerPortion: per(0.08, "kilogram") },
      { name: "Emmental", role: "salad topping", category: "cheese", productId: P.emmental, quantityPerPortion: per(0.03, "kilogram") },
      { name: "Eggs", role: "salad topping", category: "eggs", productId: P.eggs, quantityPerPortion: per(0.07, "kilogram") },
    ],
  },
  {
    id: "salmon-beetroot",
    name: "Salmon with beetroot and butter sauce",
    kitchens: ["demo-agent"],
    seasons: ["autumn", "winter"],
    description: "Fresh salmon fillet with roasted beetroot and a butter and cream sauce.",
    ingredients: [
      { name: "Salmon fillet", role: "main protein", category: "fish", productId: P.salmon, quantityPerPortion: per(0.15, "kilogram") },
      { name: "Beetroot", role: "side vegetable", category: "vegetables", productId: P.beetroot, quantityPerPortion: per(0.12, "kilogram") },
      { name: "Butter", role: "sauce base", category: "fats", productId: P.butter, quantityPerPortion: per(0.02, "kilogram") },
      { name: "Whipping cream", role: "sauce base", category: "cream", productId: P.whippingCream, quantityPerPortion: per(0.03, "litre") },
    ],
  },
  {
    id: "fried-herring",
    name: "Fried Baltic herring with mash",
    kitchens: ["demo-agent"],
    seasons: ["autumn", "winter", "spring"],
    description: "MSC Baltic herring coated in flour and fried in butter, with a lactose-free milk mash.",
    ingredients: [
      { name: "Baltic herring fillets", role: "main protein", category: "fish", productId: P.herring, quantityPerPortion: per(0.15, "kilogram") },
      { name: "Wheat flour", role: "coating", category: "pantry", productId: P.wheatFlour, quantityPerPortion: per(0.02, "kilogram") },
      { name: "Butter", role: "cooking fat", category: "fats", productId: P.butter, quantityPerPortion: per(0.02, "kilogram") },
      { name: "Whole milk", role: "mash liquid", category: "milk", productId: P.wholeMilk, quantityPerPortion: per(0.05, "litre") },
    ],
  },
  {
    id: "school-pancakes",
    name: "Milk-free oven pancakes",
    kitchens: ["school-agent"],
    seasons: ["spring", "summer", "autumn", "winter"],
    description: "The school's milk-free oven pancake, made with a calcium-fortified oat drink.",
    ingredients: [
      { name: "Wheat flour", role: "batter base", category: "pantry", productId: P.wheatFlour, quantityPerPortion: per(0.05, "kilogram") },
      { name: "Oat drink", role: "batter liquid", category: "plant-based", productId: P.oatDrink, quantityPerPortion: per(0.1, "litre") },
      { name: "Eggs", role: "binding", category: "eggs", productId: P.eggs, quantityPerPortion: per(0.07, "kilogram") },
    ],
  },
]);

const stock = (productId: string, amount: number, unit: "litre" | "kilogram" | "piece") => ({ productId, quantity: { amount, unit } });

/** What each kitchen has on hand at the start, by its agent's ID. */
export const initialInventory = {
  "demo-agent": z.array(inventoryItemSchema).parse([
    stock(P.beetroot, 5, "kilogram"),
    stock(P.choppedTomatoes, 10, "kilogram"),
    stock(P.cherryTomatoes, 1, "kilogram"),
    stock(P.oatCream, 2, "litre"),
    stock(P.oatCreamOatly, 3, "litre"),
    stock(P.whippingCream, 4, "litre"),
    stock(P.butter, 4, "kilogram"),
    stock(P.emmental, 2, "kilogram"),
    stock(P.eggs, 4, "kilogram"),
    stock(P.wheatFlour, 12, "kilogram"),
    stock(P.wholeMilk, 8, "litre"),
    stock(P.salmon, 0, "kilogram"),
    stock(P.herring, 0, "kilogram"),
  ]),
  "school-agent": z.array(inventoryItemSchema).parse([
    stock(P.beetroot, 3, "kilogram"),
    stock(P.choppedTomatoes, 5, "kilogram"),
    stock(P.oatCream, 1, "litre"),
    stock(P.wheatFlour, 20, "kilogram"),
    stock(P.oatDrink, 15, "litre"),
    stock(P.eggs, 6, "kilogram"),
  ]),
};
