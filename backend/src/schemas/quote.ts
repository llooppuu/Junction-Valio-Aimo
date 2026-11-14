import { z } from "zod";
import { allergenInputSchema, labelSchema } from "./product.js";

/** A requested quantity. "package" means whole packages; other units must match the product. */
export const requestedQuantitySchema = z.strictObject({
  amount: z.number().positive(),
  unit: z.enum(["package", "litre", "kilogram", "piece"]),
});

/** What every product in the quote must satisfy, for example lactose-free by Monday. */
export const requirementsSchema = z.strictObject({
  attributes: z.array(z.string().min(1)).max(20).optional(),
  /** Certificates or labels every product must carry, for example ["msc"]. */
  labels: z.array(labelSchema).max(10).optional(),
  /** Allergens no product may contain, or may contain as traces. */
  excludeAllergens: z.array(allergenInputSchema).max(14).optional(),
  deliverBy: z.iso.date().optional(),
});

export const createQuoteSchema = z
  .strictObject({
    lines: z
      .array(
        z
          .strictObject({
            productId: z.string().min(1).optional(),
            /** A signed product offer from GET /api/products, in place of productId. Tampered or expired offers are refused. */
            offerToken: z.string().min(1).max(4000).optional(),
            quantity: requestedQuantitySchema,
          })
          .refine((line) => (line.productId === undefined) !== (line.offerToken === undefined), {
            message: "Give either productId or offerToken, not both",
          }),
      )
      .min(1)
      .max(20),
    requirements: requirementsSchema.optional(),
    /** An out-of-date quote that this quote replaces. Its requirements carry over. */
    replacesQuoteId: z.string().min(1).optional(),
    /** A menu plan from POST /api/recipes/plan that this quote orders, so the buyer sees the calculation. */
    planId: z.string().min(1).optional(),
  })
  .refine(
    (quote) => {
      const ids = quote.lines.flatMap((line) => (line.productId ? [line.productId] : []));
      return new Set(ids).size === ids.length;
    },
    { message: "Each product can appear only once in a quote", path: ["lines"] },
  );

export const decisionSchema = z.strictObject({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type RequestedQuantity = z.infer<typeof requestedQuantitySchema>;
export type Requirements = z.infer<typeof requirementsSchema>;
