import { z } from "zod";
import { ingredientRoleSchema, packageUnitSchema, productCategorySchema } from "./product.js";

export { ingredientRoleSchema };

export const ingredientSchema = z.strictObject({
  name: z.string().min(1),
  role: ingredientRoleSchema,
  category: productCategorySchema,
  /** The product the kitchen normally uses. */
  productId: z.string().min(1),
  /** How much one portion needs, in the product's own unit. */
  quantityPerPortion: z.strictObject({ amount: z.number().positive(), unit: packageUnitSchema }),
});

export const recipeSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** The kitchens that cook it, by their agent's ID. */
  kitchens: z.array(z.enum(["demo-agent", "school-agent"])).min(1),
  /** Seasons in which the dish is on the menu, for planning around a seasonal ingredient. */
  seasons: z.array(z.enum(["spring", "summer", "autumn", "winter"])).min(1),
  description: z.string().min(1),
  ingredients: z.array(ingredientSchema).min(1),
});

export const inventoryItemSchema = z.strictObject({
  productId: z.string().min(1),
  /** On hand in the kitchen, in the product's own unit. */
  quantity: z.strictObject({ amount: z.number().nonnegative(), unit: packageUnitSchema }),
});

export const recipesQuerySchema = z.strictObject({
  season: z.enum(["spring", "summer", "autumn", "winter"]).optional(),
  /** Recipes that use an ingredient, matched against product IDs and ingredient names, for example "beetroot". */
  uses: z.string().trim().min(2).max(60).optional(),
});

export const planMenuSchema = z.strictObject({
  dishes: z
    .array(z.strictObject({ recipeId: z.string().min(1), portions: z.number().int().min(1).max(5000) }))
    .min(1)
    .max(10),
  /** Latest acceptable delivery date. Products that arrive later are flagged as problems. */
  deliverBy: z.iso.date().optional(),
  /** The kitchen to plan for. An agent always plans for its own kitchen; the buyer picks one. */
  agentId: z.enum(["demo-agent", "school-agent"]).optional(),
});

export const inventoryQuerySchema = z.strictObject({
  agentId: z.enum(["demo-agent", "school-agent"]).optional(),
});

export type Recipe = z.infer<typeof recipeSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type IngredientRole = z.infer<typeof ingredientRoleSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
