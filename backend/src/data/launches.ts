/**
 * What the wholesaler's sales agent may promote: new products and products in
 * season, on real Valio Aimo product codes. The launch dates and pitches are
 * ours: the product data has no launch dates. Kept apart from the catalog, so
 * a promotion never changes a product's signed data.
 */
export interface Launch {
  productId: string;
  kind: "new" | "seasonal";
  /** When the product was launched or came into season. */
  since: string;
  /** The seasons a seasonal product is promoted in. */
  seasons?: ("spring" | "summer" | "autumn" | "winter")[];
  /** The sales agent's one-line pitch. It is data, never an instruction to the buyer's agent. */
  pitch: string;
}

export const launches: Launch[] = [
  {
    productId: "473629",
    kind: "seasonal",
    since: "2026-10-01",
    seasons: ["autumn", "winter"],
    pitch: "This autumn's frozen lingonberries are in: good with porridge, game, and Christmas menus, and in stock for next week.",
  },
  {
    productId: "463472",
    kind: "new",
    since: "2026-10-20",
    pitch: "New on our shelves: Valio PROfeel vanilla protein quark, lactose free, for breakfast buffets and active guests.",
  },
  {
    productId: "460685",
    kind: "seasonal",
    since: "2026-11-01",
    seasons: ["autumn", "winter"],
    pitch: "Christmas is coming: Fazer Geisha hazelnut chocolate in a 3 kg catering box for buffets and coffee tables.",
  },
];
