import { z } from "zod";
import { startRunSchema } from "./routes/agent.js";
import { alertsQuerySchema } from "./routes/alerts.js";
import { renewStandingOrderSchema } from "./routes/standingOrders.js";
import { quoteSuggestionSchema, suggestionsQuerySchema } from "./routes/suggestions.js";
import { issueMandateSchema, verifyMandateSchema } from "./routes/mandates.js";
import { grantAutonomySchema, revokeAutonomySchema } from "./routes/autonomy.js";
import { auditQuerySchema } from "./routes/audit.js";
import { verifyOfferSchema } from "./routes/offers.js";
import { placeOrderSchema } from "./routes/orders.js";
import {
  offersQuerySchema,
  productQuerySchema,
  productSchema,
  substitutesQuerySchema,
} from "./schemas/product.js";
import { createQuoteSchema, decisionSchema } from "./schemas/quote.js";
import { inventoryQuerySchema, planMenuSchema, recipesQuerySchema } from "./schemas/recipe.js";

/**
 * The OpenAPI 3.1 contract. Request schemas are generated from the same Zod
 * schemas the routes validate with, so the document cannot drift from the code,
 * and a test fails if a route the app serves is missing here.
 */

type Role = "agent" | "buyer" | "wholesaler";

interface Operation {
  method: "get" | "post";
  path: string;
  summary: string;
  tag: string;
  /** Roles allowed. Empty means public. */
  roles: Role[];
  query?: z.ZodType;
  body?: z.ZodType;
  responses: Record<string, string>;
  /** A JSON Schema for the success response, where one helps an agent most. */
  responseSchema?: Record<string, unknown>;
}

const toSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;

const productListSchema = {
  type: "object",
  properties: { products: { type: "array", items: toSchema(productSchema) } },
};

const COMMON_ERRORS = { "400": "Invalid request, with a details list naming each problem" };
const AUTH_ERRORS = { "401": "Missing or unknown bearer token", "403": "The token's role may not do this" };

export const OPERATIONS: Operation[] = [
  { method: "get", path: "/api/health", summary: "Check that the backend is running", tag: "Service", roles: [], responses: { "200": "Running" } },
  {
    method: "get",
    path: "/api/products",
    summary: "Search the catalog by text, category, attributes, labels, allergens, deadline, and quantity",
    tag: "Catalog",
    roles: [],
    query: productQuerySchema,
    responses: { "200": "Matching products, each with its GS1 allergen statements, supplier reliability, and a signed offer", ...COMMON_ERRORS },
    responseSchema: productListSchema,
  },
  {
    method: "get",
    path: "/api/products/{id}",
    summary: "Read one product",
    tag: "Catalog",
    roles: [],
    responses: { "200": "The product", "404": "Unknown product" },
  },
  {
    method: "get",
    path: "/api/offers",
    summary: "Rank matching offers by price, delivery, reliability, or labels, each with a plain-language reason",
    tag: "Catalog",
    roles: [],
    query: offersQuerySchema,
    responses: { "200": "Ranked offers", ...COMMON_ERRORS },
  },
  {
    method: "post",
    path: "/api/offers/verify",
    summary: "Verify a signed product or quote offer",
    tag: "Trust",
    roles: [],
    body: verifyOfferSchema,
    responses: { "200": "{ valid: true, claims } or { valid: false, reason }", ...COMMON_ERRORS },
  },
  {
    method: "get",
    path: "/.well-known/jwks.json",
    summary: "The public key that signs offers, as a JWK Set (EdDSA, Ed25519)",
    tag: "Trust",
    roles: [],
    responses: { "200": "JWK Set" },
  },
  {
    method: "get",
    path: "/api/.well-known/jwks.json",
    summary: "The same JWK Set, under /api for the frontend's proxy",
    tag: "Trust",
    roles: [],
    responses: { "200": "JWK Set" },
  },
  {
    method: "get",
    path: "/api/allergens",
    summary: "The 14 EU allergens with their GS1 allergen type codes",
    tag: "Catalog",
    roles: [],
    responses: { "200": "Reference list" },
  },
  {
    method: "get",
    path: "/api/suppliers",
    summary: "Each supplier's reliability on time and in full, with the published formula",
    tag: "Catalog",
    roles: [],
    responses: { "200": "Suppliers by score" },
  },
  {
    method: "get",
    path: "/api/substitutes",
    summary: "Good, better, and best substitutes with score breakdowns. An agent's token applies its policy",
    tag: "Catalog",
    roles: [],
    query: substitutesQuerySchema,
    responses: { "200": "Substitutes and excluded products with reasons", "404": "Unknown product", ...COMMON_ERRORS },
  },
  {
    method: "post",
    path: "/api/quotes",
    summary: "Create a quote at fixed catalog prices, from product IDs or signed product offers",
    tag: "Purchasing",
    roles: ["agent", "buyer"],
    body: createQuoteSchema,
    responses: {
      "201": "The quote with its permission decision, the checks behind it, and a signed offer",
      "409": "Not enough stock, or a signed offer whose price has changed",
      "422": "A requirement or allergen rule is broken, the offer is tampered or expired, or the buyer's allergen rule blocks it",
      ...COMMON_ERRORS,
      ...AUTH_ERRORS,
    },
  },
  { method: "get", path: "/api/quotes", summary: "List quotes, newest first", tag: "Purchasing", roles: ["agent", "buyer"], responses: { "200": "Quotes", ...AUTH_ERRORS } },
  { method: "get", path: "/api/quotes/{id}", summary: "Read one quote", tag: "Purchasing", roles: ["agent", "buyer"], responses: { "200": "The quote", "404": "Unknown quote", ...AUTH_ERRORS } },
  {
    method: "post",
    path: "/api/quotes/{id}/recheck",
    summary: "Recheck a quote against current stock",
    tag: "Purchasing",
    roles: ["agent", "buyer"],
    responses: { "200": "The quote, marked out of date with shortfalls if stock fell", "404": "Unknown quote", ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/quotes/{id}/audit",
    summary: "One quote's history, oldest first",
    tag: "Audit",
    roles: ["agent", "buyer"],
    responses: { "200": "Audit entries", "404": "Unknown quote", ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/quotes/{id}/decision",
    summary: "Approve or reject a quote that needs approval",
    tag: "Purchasing",
    roles: ["buyer"],
    body: decisionSchema,
    responses: { "200": "The decided quote", "409": "The quote does not need a decision, or stock has fallen", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/quotes/{id}/shortfall-options",
    summary: "Ranked ways to cover an out-of-date quote's shortfall",
    tag: "Purchasing",
    roles: ["agent", "buyer"],
    responses: { "200": "Plans with options and exclusions", "409": "The quote has no shortfall", ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/orders",
    summary: "Order an authorized quote. Retrying returns the same order",
    tag: "Purchasing",
    roles: ["agent", "buyer"],
    body: placeOrderSchema,
    responses: {
      "201": "Order placed",
      "200": "The existing order for this quote",
      "409": "The quote needs approval, was rejected, or is out of date",
      "422": "The cited signed offer is tampered, expired, or for another quote",
      ...COMMON_ERRORS,
      ...AUTH_ERRORS,
    },
  },
  { method: "get", path: "/api/orders", summary: "List orders, newest first", tag: "Purchasing", roles: ["agent", "buyer"], responses: { "200": "Orders", ...AUTH_ERRORS } },
  { method: "get", path: "/api/orders/{id}", summary: "Read one order", tag: "Purchasing", roles: ["agent", "buyer"], responses: { "200": "The order", "404": "Unknown order", ...AUTH_ERRORS } },
  {
    method: "get",
    path: "/api/audit",
    summary: "The whole append-only audit history, newest first",
    tag: "Audit",
    roles: ["buyer"],
    query: auditQuerySchema,
    responses: { "200": "Entries and total", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/policy",
    summary: "Purchasing policies, read-only. An agent sees only its own",
    tag: "Purchasing",
    roles: ["agent", "buyer", "wholesaler"],
    responses: { "200": "Policies", ...AUTH_ERRORS },
  },
  { method: "post", path: "/api/demo/reset", summary: "Start over: clear quotes, orders, alerts, and agent runs", tag: "Demo", roles: ["buyer"], responses: { "200": "Reset", ...AUTH_ERRORS } },
  { method: "get", path: "/api/agent", summary: "Whether the AI agent is on, and its model", tag: "Agent", roles: ["agent", "buyer"], responses: { "200": "Status", ...AUTH_ERRORS } },
  {
    method: "post",
    path: "/api/agent/runs",
    summary: "Hand a request to a kitchen's AI agent",
    tag: "Agent",
    roles: ["buyer"],
    body: startRunSchema,
    responses: {
      "202": "The run, started",
      "404": "Unknown agent or conversation",
      "409": "The conversation is busy or belongs to another agent",
      "503": "No model is configured",
      ...COMMON_ERRORS,
      ...AUTH_ERRORS,
    },
  },
  { method: "get", path: "/api/agent/runs", summary: "List agent runs, newest first", tag: "Agent", roles: ["buyer"], responses: { "200": "Runs", ...AUTH_ERRORS } },
  { method: "get", path: "/api/agent/runs/{id}", summary: "Read one run and its steps", tag: "Agent", roles: ["buyer"], responses: { "200": "The run", "404": "Unknown run", ...AUTH_ERRORS } },
  {
    method: "get",
    path: "/api/wholesaler/activity",
    summary: "The wholesaler's view of agent activity across every buyer: per-agent counts, quotes waiting, and refused or blocked attempts",
    tag: "Audit",
    roles: ["wholesaler"],
    responses: { "200": "Agents, waiting quotes, attention items, and recent entries", ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/recipes",
    summary: "The kitchens' recipes, each ingredient with its quantity per portion, role, category, and usual product. An agent sees its own kitchen's",
    tag: "Kitchen",
    roles: ["agent", "buyer", "wholesaler"],
    query: recipesQuerySchema,
    responses: { "200": "Recipes", ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/recipes/plan",
    summary: "Work out a menu's order: needs per product, minus inventory, rounded up to whole packages, with problems flagged",
    tag: "Kitchen",
    roles: ["agent", "buyer"],
    body: planMenuSchema,
    responses: { "201": "The plan, with quote lines ready for POST /api/quotes", "404": "Unknown recipe for this kitchen", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/recipes/{id}",
    summary: "Read one recipe",
    tag: "Kitchen",
    roles: ["agent", "buyer", "wholesaler"],
    responses: { "200": "The recipe", "404": "Unknown recipe, or another kitchen's", ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/inventory",
    summary: "Each kitchen's stock on hand. An agent sees only its own kitchen",
    tag: "Kitchen",
    roles: ["agent", "buyer"],
    query: inventoryQuerySchema,
    responses: { "200": "Kitchens with their items", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/alerts",
    summary: "Stock alerts the agents raised on their own when a supplier could no longer cover a recipe or a planned order, each with a substitute per ingredient role. An agent sees only its own",
    tag: "Kitchen",
    roles: ["agent", "buyer", "wholesaler"],
    query: alertsQuerySchema,
    responses: { "200": "Alerts, newest first", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/standing-orders",
    summary: "Each kitchen's weekly standing order compared with its last eight weeks: mean, spread, and change per line and in total, flagged beyond 20%. An agent sees only its own",
    tag: "Kitchen",
    roles: ["agent", "buyer", "wholesaler"],
    responses: { "200": "Reviews", ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/standing-orders/renew",
    summary: "Renew the standing order as a quote. The lines come from the planned order; a drifted renewal needs the buyer's approval and carries the trend",
    tag: "Kitchen",
    roles: ["agent", "buyer"],
    body: renewStandingOrderSchema,
    responses: { "201": "The renewal quote and its review", "404": "No standing order for this kitchen", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/suggestions",
    summary: "The wholesaler's suggestions of new and seasonal products, as each buyer's agent screened them against its buyer's policy. An agent sees only its own",
    tag: "Kitchen",
    roles: ["agent", "buyer"],
    query: suggestionsQuerySchema,
    responses: { "200": "Suggestions, newest first", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/suggestions/{id}/quote",
    summary: "Quote a suggestion. An agent's quote always waits for the buyer, because the wholesaler suggested it",
    tag: "Kitchen",
    roles: ["agent", "buyer"],
    body: quoteSuggestionSchema,
    responses: { "201": "The quote", "404": "Unknown suggestion, or another kitchen's", "409": "Held back or dismissed", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/suggestions/{id}/dismiss",
    summary: "Dismiss a suggestion",
    tag: "Kitchen",
    roles: ["buyer"],
    responses: { "200": "The suggestion", "404": "Unknown suggestion", ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/wholesaler/suggestions",
    summary: "Run the wholesaler's sales agent: suggest current new and seasonal products to every buyer's agent, each screened at once",
    tag: "Wholesaler",
    roles: ["wholesaler"],
    responses: { "201": "What was sent", ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/wholesaler/suggestions",
    summary: "Every suggestion the sales agent sent, with each buyer's agent's verdict",
    tag: "Wholesaler",
    roles: ["wholesaler"],
    responses: { "200": "Suggestions, newest first", ...AUTH_ERRORS },
  },
  {
    method: "get",
    path: "/api/mandates",
    summary: "The buyer's mandates for its agents, each a W3C Verifiable Credential (VC-JWT, EdDSA) issued by the buyer's did:key. An agent sees only its own",
    tag: "Trust",
    roles: ["agent", "buyer", "wholesaler"],
    responses: { "200": "The issuer and the mandates, newest first", ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/mandates",
    summary: "Sign a new mandate for an agent: spending limit, allowed categories, and validity. It replaces the agent's current mandate",
    tag: "Trust",
    roles: ["buyer"],
    body: issueMandateSchema,
    responses: { "201": "The new mandate", "404": "Unknown agent", "422": "Above the agent's policy limit", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/mandates/{id}/revoke",
    summary: "Revoke a mandate. The agent is refused on its next request",
    tag: "Trust",
    roles: ["buyer"],
    responses: { "200": "The revoked mandate", "404": "Unknown mandate", "409": "Not active", ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/mandates/verify",
    summary: "Verify a mandate from the token alone, against the public key in its issuer's did:key, and report whether it is still in force",
    tag: "Trust",
    roles: [],
    body: verifyMandateSchema,
    responses: { "200": "The verification result and status", ...COMMON_ERRORS },
  },
  {
    method: "get",
    path: "/api/autonomy",
    summary: "Earned autonomy: each agent's track record per product category, whether it may order alone there, and up to what total. An agent sees only its own",
    tag: "Trust",
    roles: ["agent", "buyer", "wholesaler"],
    responses: { "200": "Each agent's autonomy settings and categories", ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/autonomy/{agentId}/categories/{category}/grant",
    summary: "Grant an agent autonomy in a category directly, up to a total no higher than its policy limit. Only the buyer can",
    tag: "Trust",
    roles: ["buyer"],
    body: grantAutonomySchema,
    responses: { "200": "The category's new status", "404": "Unknown agent or category", "422": "Above the agent's policy limit", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  {
    method: "post",
    path: "/api/autonomy/{agentId}/categories/{category}/revoke",
    summary: "Take an agent's autonomy in a category back. It is supervised there until it earns it again",
    tag: "Trust",
    roles: ["buyer"],
    body: revokeAutonomySchema,
    responses: { "200": "The category's new status", "404": "Unknown agent or category", ...COMMON_ERRORS, ...AUTH_ERRORS },
  },
  { method: "get", path: "/api/openapi.json", summary: "This document", tag: "Service", roles: [], responses: { "200": "OpenAPI 3.1 document" } },
];

/** Query parameters from an object schema's JSON Schema. */
function queryParameters(schema: z.ZodType) {
  const json = toSchema(schema) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, property]) => ({
    name,
    in: "query",
    required: json.required?.includes(name) ?? false,
    ...(typeof property.description === "string" ? { description: property.description } : {}),
    schema: property,
  }));
}

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of OPERATIONS) {
    const pathParameters = [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const roles = operation.roles.length > 0 ? ` Needs the ${operation.roles.join(" or ")} role.` : " Public.";
    paths[operation.path] ??= {};
    paths[operation.path]![operation.method] = {
      operationId: `${operation.method}${operation.path.replace(/[^a-zA-Z0-9]+(\w)?/g, (_m, c: string | undefined) => (c ?? "").toUpperCase())}`,
      summary: operation.summary,
      description: `${operation.summary}.${roles}`,
      tags: [operation.tag],
      ...(operation.roles.length > 0 ? { security: [{ bearer: [] }] } : {}),
      parameters: [...pathParameters, ...(operation.query ? queryParameters(operation.query) : [])],
      ...(operation.body
        ? { requestBody: { required: true, content: { "application/json": { schema: toSchema(operation.body) } } } }
        : {}),
      responses: Object.fromEntries(
        Object.entries(operation.responses).map(([status, description]) => [
          status,
          {
            description,
            ...(operation.responseSchema && status.startsWith("2")
              ? { content: { "application/json": { schema: operation.responseSchema } } }
              : {}),
          },
        ]),
      ),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Trusted Trade Agents API",
      version: "0.1.0",
      description:
        "How an external purchasing agent finds products, compares offers, orders at fixed prices, and stays within the buyer's rules. Every rule is enforced on the server. All data is synthetic.",
    },
    servers: [{ url: "http://localhost:3001" }],
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "A demo token for the agent or buyer role" },
      },
    },
    paths,
  };
}
