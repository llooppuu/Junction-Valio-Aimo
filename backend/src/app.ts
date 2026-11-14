import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from "express";
import { ValioRateLimitedError, ValioUnavailableError } from "./services/valio.js";
import type { AgentModel } from "./agent/model.js";
import { createOpenAiModel } from "./agent/openai-model.js";
import { config } from "./config.js";
import { ApiError } from "./http.js";
import { agentRouter } from "./routes/agent.js";
import { alertsRouter } from "./routes/alerts.js";
import { standingOrdersRouter } from "./routes/standingOrders.js";
import { suggestionsRouter } from "./routes/suggestions.js";
import { mandatesRouter } from "./routes/mandates.js";
import { allergensRouter } from "./routes/allergens.js";
import { auditRouter } from "./routes/audit.js";
import { demoRouter } from "./routes/demo.js";
import { healthRouter } from "./routes/health.js";
import { offersRouter } from "./routes/offers.js";
import { ordersRouter } from "./routes/orders.js";
import { policyRouter } from "./routes/policy.js";
import { productsRouter } from "./routes/products.js";
import { quotesRouter } from "./routes/quotes.js";
import { substitutesRouter } from "./routes/substitutes.js";
import { suppliersRouter } from "./routes/suppliers.js";
import { wholesalerRouter } from "./routes/wholesaler.js";
import { inventoryRouter, recipesRouter } from "./routes/recipes.js";
import { openApiDocument } from "./openapi.js";
import { jwks } from "./services/signing.js";
import { createStore, type Store } from "./store.js";

export interface AppOptions {
  store?: Store;
  /**
   * The AI agent's model. By default it is GPT from the OpenAI settings in
   * .env, or null (agent switched off) when no API key is set.
   */
  agentModel?: AgentModel | null;
}

function defaultAgentModel(): AgentModel | null {
  if (!config.OPENAI_API_KEY) return null;
  return createOpenAiModel({
    apiKey: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL,
    reasoningEffort: config.OPENAI_REASONING_EFFORT,
  });
}

export interface ApiRoute {
  method: string;
  /** In OpenAPI form, with {id} for a path parameter. */
  path: string;
}

/** The routes a router defines, from Express's own route table. */
function routesOf(base: string, router: Router): ApiRoute[] {
  const stack = (router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack;
  return stack.flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map((method) => ({
          method,
          path: `${base}${layer.route!.path === "/" ? "" : layer.route!.path}`.replace(/:(\w+)/g, "{$1}"),
        }))
      : [],
  );
}

export function createApp({ store = createStore(), agentModel = defaultAgentModel() }: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  // Routes registered directly on the app, so the route table below can list them too.
  const appRoutes: ApiRoute[] = [];
  const get = (paths: string[], handler: (req: Request, res: Response) => void) => {
    app.get(paths, handler);
    appRoutes.push(...paths.map((path) => ({ method: "get", path })));
  };

  // The public key that signs offers, at the standard location and under /api for the frontend's proxy.
  get(["/.well-known/jwks.json", "/api/.well-known/jwks.json"], (_req, res) => {
    res.json(jwks());
  });
  // The OpenAPI 3.1 contract, generated from the same Zod schemas the routes validate with.
  get(["/api/openapi.json"], (_req, res) => {
    res.json(openApiDocument());
  });

  const mounts: [string, Router][] = [
    ["/api/health", healthRouter],
    ["/api/products", productsRouter(store)],
    ["/api/offers", offersRouter(store)],
    ["/api/allergens", allergensRouter()],
    ["/api/suppliers", suppliersRouter(store)],
    ["/api/substitutes", substitutesRouter(store)],
    ["/api/quotes", quotesRouter(store)],
    ["/api/orders", ordersRouter(store)],
    ["/api/audit", auditRouter(store)],
    ["/api/policy", policyRouter(store)],
    ["/api/demo", demoRouter(store)],
    ["/api/agent", agentRouter(store, agentModel)],
    ["/api/wholesaler", wholesalerRouter(store)],
    ["/api/recipes", recipesRouter(store)],
    ["/api/inventory", inventoryRouter(store)],
    ["/api/alerts", alertsRouter(store)],
    ["/api/standing-orders", standingOrdersRouter(store)],
    ["/api/suggestions", suggestionsRouter(store)],
    ["/api/mandates", mandatesRouter(store)],
  ];
  for (const [path, router] of mounts) app.use(path, router);
  // Every route the app serves, for the test that keeps the OpenAPI document complete.
  app.locals.routes = [...appRoutes, ...mounts.flatMap(([path, router]) => routesOf(path, router))];

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Express identifies error handlers by their four parameters.
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ApiError) {
        res.status(error.status).json({ error: error.message, ...error.extra });
        return;
      }
      // Valio Aimo's APIs did not answer: say so plainly, and never guess a price or stock.
      if (error instanceof ValioUnavailableError) {
        // When Valio Aimo's rate limit is the cause, tell the caller when to try again.
        if (error instanceof ValioRateLimitedError) res.setHeader("Retry-After", String(Math.max(1, error.retryAfterSeconds)));
        res.status(503).json({ error: error.message, upstream: "valio-aimo" });
        return;
      }
      // Malformed JSON bodies and oversized requests from express.json().
      if (error instanceof SyntaxError || (error as { type?: string }).type === "entity.too.large") {
        const status = (error as { status?: number }).status ?? 400;
        res.status(status).json({ error: "The request body is not valid JSON or is too large." });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
