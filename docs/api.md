# API

The API is the interface an external purchasing agent uses. It is described in full by the OpenAPI 3.1 document at `GET /api/openapi.json`, which is generated from the same Zod schemas the routes validate with, so it cannot drift from the code. This page explains how to use it.

Base URL in development: `http://localhost:3001`. In the Docker image, the API and the frontend share one port (8080 by default).

## Authentication and roles

Every caller sends a bearer token: `Authorization: Bearer <token>`. Each token belongs to one caller with one role.

| Role | Demo token (from `.env`) | May |
| --- | --- | --- |
| Agent (hotel chain) | `AGENT_TOKEN` | Search, compare, quote, and order within its own rules and mandate. Sees only its own quotes, policy, and alerts. |
| Agent (school kitchen) | `SCHOOL_AGENT_TOKEN` | The same, under the school kitchen's stricter allergen and nutrition rules. |
| Buyer (head chef) | `BUYER_TOKEN` | Everything an agent may, plus approve or reject quotes, issue and revoke mandates, grant or revoke autonomy, and read the whole audit history. |
| Wholesaler | `WHOLESALER_TOKEN` | Valio Aimo's operations view: agent activity across every buyer, and the sales agent's suggestions. |

The catalog, the public signing key, mandate and offer verification, and the OpenAPI document need no token.

**Mandates.** An agent acts only under a mandate the buyer signed: a W3C Verifiable Credential. The server checks it on every agent request; if the buyer revokes it, the agent's next request is refused. An agent may present its mandate in the `X-Agent-Mandate` header, and it must then be the buyer's current one. See [Trust and controls](trust-and-controls.md#mandates).

## The brief's request, step by step

The examples use the hotel agent's demo token. Prices and stock are Valio Aimo's live mock data, so your numbers may differ.

### 1. Read your own rules

```bash
curl -H "Authorization: Bearer demo-agent-token" http://localhost:3001/api/policy
```

The policy is read-only: spending and daily limits, excluded allergens, required attributes (the hotel's milk must be lactose-free), and the earned-autonomy settings.

### 2. Compare offers that meet the request

```bash
curl -H "Authorization: Bearer demo-agent-token" \
  "http://localhost:3001/api/offers?category=milk&attributes=lactose-free&deliverBy=2026-11-16&unit=litre&minQuantity=1000&rankBy=price"
```

The server searches Valio Aimo's product data, fetches live price and availability for the best matches only, and ranks them. Each offer has a plain-language reason and a signed offer token:

```json
{
  "rankBy": "price",
  "offers": [
    {
      "rank": 1,
      "unitPriceEurCents": 101,
      "reason": "The cheapest per litre in these results (€1.01), with 100% delivered as ordered and Finnish origin.",
      "product": {
        "id": "464306",
        "name": "Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free",
        "pricePerPackageEurCents": 101,
        "stockStatus": "unknown",
        "deliveryDate": "2026-11-16",
        "orderCutoff": "2026-11-15T17:00:00+0200",
        "allergens": ["milk"],
        "offer": { "token": "eyJhbGciOiJFZERTQSIs…" }
      }
    }
  ],
  "unavailable": []
}
```

`rankBy` can be `price` (per litre or kilogram), `delivery`, `reliability`, `labels` (with `preferLabels`), or `carbon`. Search parameters: `q` (text, English or Finnish), `category`, `attributes`, `labels`, `excludeAllergens`, `deliverBy`, `minQuantity` with its `unit`, and `limit` (20 by default, 50 at most). Lists are comma-separated. Add `search=semantic` to rank by what the words mean rather than matching them, in English or Finnish; the answer's `source.search` says which was used.

### 3. Create a quote at the fixed price

```bash
curl -X POST -H "Authorization: Bearer demo-agent-token" -H "Content-Type: application/json" \
  -d '{"lines":[{"productId":"464306","quantity":{"amount":1000,"unit":"litre"}}],
       "requirements":{"attributes":["lactose-free"],"deliverBy":"2026-11-16"}}' \
  http://localhost:3001/api/quotes
```

A line can name a `productId` or carry the signed `offerToken` from step 2. Quantities are in `litre`, `kilogram`, `piece`, or `package`; the server rounds up to whole sales units. Clients never send prices.

The answer is the quote with the server's decision and every rule it checked:

```json
{
  "quote": {
    "id": "Q-0001",
    "status": "needs_approval",
    "totalEurCents": 101000,
    "permission": {
      "decision": "needs_approval",
      "reason": "The buyer must approve it: the agent has not yet earned autonomy in milk (1 more approval in a row needed).",
      "reasonFi": "Ostajan on hyväksyttävä: agentti ei ole vielä ansainnut itsenäisyyttä: maito (tarvitaan vielä 1 peräkkäistä hyväksyntää).",
      "checks": [
        { "rule": "spending_limit", "outcome": "passed", "detail": "€1,010.00 is within the limit of €1,400.00" },
        { "rule": "allergens", "outcome": "passed", "detail": "free from peanuts and nuts" },
        { "rule": "required_attributes", "outcome": "passed", "detail": "every product has the attributes the buyer requires" },
        { "rule": "earned_autonomy", "outcome": "needs_approval", "detail": "the agent has not yet earned autonomy in milk (1 more approval in a row needed)" }
      ]
    },
    "alternatives": [{ "productId": "464401", "verdict": "not_chosen", "reason": "Not chosen: meets every requirement and could cover all 1,000 L, but €0.09 more per litre than …" }],
    "offer": { "token": "eyJhbGciOiJFZERTQSIs…" }
  }
}
```

`status` is `within_limit` (the agent may order it), `needs_approval` (the buyer decides), or, for a buyer's own quote, `approved`. A quote that breaks a hard rule, such as an excluded allergen, is not created at all: the answer is `422` with `blocked: true`.

### 4. The buyer decides

```bash
curl -X POST -H "Authorization: Bearer demo-buyer-token" -H "Content-Type: application/json" \
  -d '{"decision":"approve","note":"Fine for the breakfast buffet"}' \
  http://localhost:3001/api/quotes/Q-0001/decision
```

Only the buyer can decide, only on a quote that needs approval, and only on that exact quote: quotes never change after they are created, so an approval cannot carry over to different lines or totals.

### 5. Place the order

```bash
curl -X POST -H "Authorization: Bearer demo-agent-token" -H "Content-Type: application/json" \
  -d '{"quoteId":"Q-0001"}' http://localhost:3001/api/orders
```

Before committing, the server asks Valio Aimo for price and availability again. If stock changed, the quote becomes `out_of_date` and the answer lists the shortfall; `GET /api/quotes/{id}/shortfall-options` ranks the ways to cover it. Retrying an order returns the same order with `"created": false`, so a quote can become at most one order.

Valio Aimo's mock environment has no order API, so an order is recorded here, and `GET /api/orders/{id}/ubl` gives it as a PEPPOL BIS Order 3.0 document (UBL 2.1 XML) for a person to send on or a system to import. See [Valio Aimo integration](valio-integration.md#orders-wait-for-a-person).

## Endpoints

| Area | Method and path | Who | What it does |
| --- | --- | --- | --- |
| Catalog | `GET /api/products` | public | Search by text or by meaning, category, attributes, labels, allergens, deadline, and quantity |
| | `GET /api/products/{id}` | public | One product with live price and availability |
| | `GET /api/offers` | public | Rank matching offers by price, delivery, reliability, labels, or carbon footprint, each with a reason |
| | `GET /api/allergens` | public | The 14 EU allergens with their GS1 allergen type codes |
| | `GET /api/suppliers` | public | Each supplier's delivery reliability, with the published formula |
| | `GET /api/substitutes` | public | Good, better, and best substitutes with score breakdowns; an agent's token applies its policy |
| Purchasing | `POST /api/quotes` | agent, buyer | A quote at fixed catalog prices, from product IDs or signed offers |
| | `GET /api/quotes`, `GET /api/quotes/{id}` | agent, buyer | Quotes, newest first; an agent sees its own |
| | `POST /api/quotes/{id}/recheck` | agent, buyer | Recheck a quote against current stock |
| | `POST /api/quotes/{id}/decision` | buyer | Approve or reject a quote that needs approval |
| | `GET /api/quotes/{id}/shortfall-options` | agent, buyer | Ranked ways to cover an out-of-date quote's shortfall |
| | `POST /api/orders` | agent, buyer | Order an authorized quote; retrying returns the same order |
| | `GET /api/orders`, `GET /api/orders/{id}` | agent, buyer | Orders, newest first |
| | `GET /api/orders/{id}/ubl` | agent, buyer | The order as a PEPPOL BIS Order 3.0 document (UBL 2.1 XML) |
| | `GET /api/policy` | agent, buyer, wholesaler | Purchasing policies, read-only; an agent sees its own |
| Trust | `GET /.well-known/jwks.json` | public | The public key that signs offers (EdDSA, Ed25519) |
| | `POST /api/offers/verify` | public | Verify a signed product or quote offer |
| | `GET /api/mandates` | agent, buyer, wholesaler | The buyer's mandates, each a W3C Verifiable Credential |
| | `POST /api/mandates` | buyer | Sign a new mandate for an agent |
| | `POST /api/mandates/{id}/revoke` | buyer | Revoke a mandate; the agent is refused on its next request |
| | `POST /api/mandates/verify` | public | Verify a mandate from the token alone |
| | `GET /api/autonomy` | agent, buyer, wholesaler | Each agent's earned autonomy per product category |
| | `POST /api/autonomy/{agentId}/categories/{category}/grant` | buyer | Grant autonomy in a category, up to the policy limit |
| | `POST /api/autonomy/{agentId}/categories/{category}/revoke` | buyer | Take autonomy in a category back |
| Kitchen | `GET /api/recipes`, `GET /api/recipes/{id}` | agent, buyer, wholesaler | Recipes with quantities per portion and ingredient roles |
| | `POST /api/recipes/plan` | agent, buyer | A menu's order: needs minus inventory, in whole packages, with problems flagged |
| | `GET /api/inventory` | agent, buyer | Each kitchen's stock on hand |
| | `GET /api/alerts` | agent, buyer, wholesaler | Stock alerts the agents raised themselves, with a substitute per ingredient role |
| | `GET /api/standing-orders` | agent, buyer, wholesaler | Each standing order against its last eight weeks, flagged beyond 20% |
| | `POST /api/standing-orders/renew` | agent, buyer | Renew a standing order as a quote; a drifted renewal needs approval |
| | `GET /api/suggestions` | agent, buyer | The wholesaler's suggestions, as each buyer's agent screened them |
| | `POST /api/suggestions/{id}/quote` | agent, buyer | Quote a suggestion; an agent's quote always waits for the buyer |
| | `POST /api/suggestions/{id}/dismiss` | buyer | Dismiss a suggestion |
| Agent | `POST /api/mcp` | agent | The same interface as an MCP server (Streamable HTTP); see [MCP clients](mcp.md) |
| | `GET /api/agent` | agent, buyer | Whether the AI agent is on, and its model |
| | `POST /api/agent/runs` | buyer | Hand a request to a kitchen's AI agent |
| | `GET /api/agent/runs`, `GET /api/agent/runs/{id}` | buyer | Runs and every API call each made |
| | `POST /api/agent/runs/{id}/cancel` | buyer | Cancel a run in progress; anything it already did is kept |
| | `GET /api/voice` | buyer | Whether voice input is on, and its Gemini Live model |
| | `POST /api/voice/token` | buyer | A single-use Gemini Live token for dictating one request, in `en` or `fi` |
| Audit | `GET /api/audit` | buyer | The whole append-only audit history, newest first |
| | `GET /api/quotes/{id}/audit` | agent, buyer | One quote's history, oldest first |
| Wholesaler | `GET /api/wholesaler/activity` | wholesaler | Agent activity across every buyer: counts, waiting quotes, refused attempts |
| | `POST /api/wholesaler/suggestions` | wholesaler | Run the sales agent: suggest new and seasonal products to every buyer's agent |
| | `GET /api/wholesaler/suggestions` | wholesaler | Every suggestion sent, with each buyer's agent's verdict |
| Service | `GET /api/health`, `GET /api/openapi.json` | public | Health check and this API's OpenAPI 3.1 document |
| Demo | `POST /api/demo/reset` | buyer | Start over: clear quotes, orders, alerts, and agent runs |

## Errors

Every error is JSON with an `error` sentence a person can read, and often more fields an agent can act on.

| Status | Meaning | Extra fields |
| --- | --- | --- |
| `400` | The request does not match the schema | `details`: one entry per problem |
| `401` | Missing or unknown token | |
| `403` | The role may not do this, or the agent's mandate does not allow it | `mandate: true` for mandate refusals |
| `404` | Unknown product, quote, order, or mandate | |
| `409` | The state does not allow it, for example ordering a quote that waits for approval, or stock that changed | `shortfalls`, `quoteStatus` |
| `422` | A hard rule blocks it, or the request names an unknown product | `blocked: true` and `checks` for a rule that cannot be approved |
| `503` | Valio Aimo's price and availability service did not answer | `upstream: "valio-aimo"`, and a `Retry-After` header when its rate limit is the cause |

Every refusal is also recorded in the audit history, so the buyer and the wholesaler see attempts that did not succeed.
