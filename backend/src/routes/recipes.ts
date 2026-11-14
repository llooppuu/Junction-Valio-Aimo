import { Router } from "express";
import { liveProducts, substituteCandidates } from "../services/market.js";
import { currentPrincipal, requireRole } from "../auth.js";
import { ApiError, parseOr400 } from "../http.js";
import { recipes } from "../data/recipes.js";
import { inventoryQuerySchema, planMenuSchema, recipesQuerySchema } from "../schemas/recipe.js";
import { planMenu } from "../services/menuPlan.js";
import type { Store } from "../store.js";

/** The kitchens' recipes. An agent sees only its own kitchen's. */
export function recipesRouter(store: Store) {
  const router = Router();
  const anyRole = requireRole(store, "agent", "buyer", "wholesaler");
  const visible = (agentId: string | undefined) =>
    agentId ? recipes.filter((recipe) => recipe.kitchens.includes(agentId as never)) : recipes;

  router.get("/", anyRole, (req, res) => {
    const query = parseOr400(recipesQuerySchema, req.query, res);
    if (!query) return;
    const principal = currentPrincipal(res);
    const uses = query.uses?.toLowerCase();
    res.json({
      recipes: visible(principal.role === "agent" ? principal.id : undefined).filter(
        (recipe) =>
          (!query.season || recipe.seasons.includes(query.season)) &&
          (!uses ||
            recipe.ingredients.some(
              (ingredient) => ingredient.productId.toLowerCase().includes(uses) || ingredient.name.toLowerCase().includes(uses),
            )),
      ),
    });
  });

  // Need → recipe → order: the server works out the order for a menu, so the arithmetic is never guessed.
  router.post("/plan", requireRole(store, "agent", "buyer"), async (req, res) => {
    const input = parseOr400(planMenuSchema, req.body, res);
    if (!input) return;
    const principal = currentPrincipal(res);
    const agentId = principal.role === "agent" ? principal.id : (input.agentId ?? "demo-agent");
    // The plan's ingredients, and possible substitutes for each, get live data for the delivery date.
    const ingredients = input.dishes.flatMap((dish) => recipes.find((recipe) => recipe.id === dish.recipeId)?.ingredients.map((ingredient) => ingredient.productId) ?? []);
    const excluded = store.policies.get(agentId)?.excludedAllergens ?? [];
    const candidates = [...new Set(ingredients)].flatMap((id) => substituteCandidates(store, id, 30, { excludeAllergens: excluded, processed: true }).map((entry) => entry.id));
    const inventory = (store.inventory[agentId] ?? []).map((item) => item.productId);
    await liveProducts(store, [...ingredients, ...candidates, ...inventory], input.deliverBy);
    res.status(201).json({ plan: planMenu(store, { agentId, dishes: input.dishes, ...(input.deliverBy ? { deliverBy: input.deliverBy } : {}) }, principal) });
  });

  router.get("/:id", anyRole, (req, res) => {
    const principal = currentPrincipal(res);
    const recipe = visible(principal.role === "agent" ? principal.id : undefined).find(
      (candidate) => candidate.id === String(req.params.id),
    );
    if (!recipe) throw new ApiError(404, `Unknown recipe "${String(req.params.id)}".`);
    res.json({ recipe });
  });

  return router;
}

/** Each kitchen's stock on hand. An agent sees only its own kitchen; the buyer can pick one or see both. */
export function inventoryRouter(store: Store) {
  const router = Router();

  router.get("/", requireRole(store, "agent", "buyer"), (req, res) => {
    const query = parseOr400(inventoryQuerySchema, req.query, res);
    if (!query) return;
    const principal = currentPrincipal(res);
    const agentIds = principal.role === "agent" ? [principal.id] : query.agentId ? [query.agentId] : Object.keys(store.inventory);
    res.json({
      kitchens: agentIds.map((agentId) => ({
        agentId,
        buyerName: store.policies.get(agentId)?.buyerName ?? agentId,
        items: store.inventory[agentId] ?? [],
      })),
    });
  });

  return router;
}
