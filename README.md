# Trusted Trade Agents

The interface and operating model that lets a kitchen's AI purchasing agent buy from Valio Aimo: find products, compare offers, order at fixed prices, and get a person's approval when its rules say so. Built at Junction 2026 for the Valio Aimo challenge #327.

It runs on **Valio Aimo's challenge material**: the 17,546-product data file, delivery reliability, carbon footprint, and the live mock **price** and **availability** APIs. Nothing is invented about the products, prices, or stock. The kitchens, their rules, recipes, and order history are ours.

## What it does

- **Lookup, in two steps.** A search runs over Valio Aimo's product data, then only the best matches (20 by default, 50 at most) get live price and availability, as the organizers ask. Every answer is a signed offer that any agent can verify.
- **Inquiry to order at a fixed price.** A quote locks Valio Aimo's price per sales unit and records the delivery date, order cut-off, VAT, and stock status. The order asks Valio Aimo again just before committing, and an order can never be placed twice.
- **Permissions and human approval.** Each kitchen's rules live on the server: spending and daily limits, allergens that block outright, required attributes, labels, nutrition, suppliers, and products without an allergen declaration. Each agent acts under a buyer-signed mandate, a W3C Verifiable Credential that the buyer can revoke at once.
- **Exceptions.** Order cut-offs, sales blocks, products Valio Aimo cannot deliver, partial stock, and supplier-warehouse stock that cannot be confirmed are all handled and explained. Substitutes follow recipe logic: chopped tomatoes can replace cherry tomatoes in a sauce but not in a salad, and salmon can be topped up with salmon, never herring.
- **Traceability.** Every step, refusal, and decision is in an append-only audit history in plain language, for the kitchen and for Valio Aimo.

An AI agent on GPT-5.5 runs the whole flow from a request in plain language, using only the public API with its own credentials. It gets no special treatment.

## Quick start

You need **Node.js 22.12 or newer** and the challenge's **Valio Aimo API key**.

```bash
npm install
cp .env.example .env        # then set VALIO_API_KEY, and OPENAI_API_KEY for the AI agent
npm run data                # builds backend/data/catalog.json from the organizers' files
npm run dev
```

`npm run data` downloads the organizers' product, reliability, and carbon files with `VALIO_API_KEY` and keeps only the built catalog, which is not in git.

| App | URL |
| --- | --- |
| Frontend | <http://localhost:5173> |
| Backend API | <http://localhost:3001/api/health> |
| OpenAPI document | <http://localhost:3001/api/openapi.json> |

In Windows PowerShell 5.1, use `curl.exe` instead of `curl`.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the backend and frontend with reloading |
| `npm run data` | Builds the catalog from Valio Aimo's product, reliability, and carbon files |
| `npm test` | Runs the backend tests on recorded Valio Aimo answers, without calling the APIs |
| `npm run test:adversarial` | Runs only the attacks by adversarial agents |
| `npm run record-fixture --workspace backend` | Records a fresh test fixture from the live APIs |
| `npm run typecheck`, `npm run build` | Type checks and builds both apps |
| `npm run preview` | Serves the built backend and frontend |

### Configuration

| Variable | Purpose |
| --- | --- |
| `VALIO_API_KEY` | Valio Aimo's mock APIs. Without it the catalog can be searched, but nothing can be priced, quoted, or ordered |
| `VALIO_API_URL` | The APIs' address, `https://junction26.valioaimo.fi` by default |
| `OPENAI_API_KEY` | Turns on the AI agent. The key stays on the server |
| `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | `gpt-5.5` and `low` by default |
| `AGENT_TOKEN`, `SCHOOL_AGENT_TOKEN`, `BUYER_TOKEN`, `WHOLESALER_TOKEN` | Demo tokens. The AI agents send their own; the Vite proxy adds the buyer's and the wholesaler's |
| `BACKEND_PORT` | The backend's port, 3001 by default |

## Project structure

```
backend/         Express API: catalog search, offers, quotes, orders, rules, mandates, audit, the AI agent
  src/           Routes, services, schemas and the agent
  scripts/       Catalog build and fixture tools
  test/          Tests on recorded Valio Aimo answers, including adversarial agents
frontend/        React + Vite buyer and wholesaler app
  src/           Components, helpers and styles
.env.example     Configuration template, copy it to .env
package.json     npm workspaces and the root commands
```

## The judges' criteria

| Criterion | Where to look |
| --- | --- |
| Working end-to-end demo | The brief's request, from plain language to a fixed-price order on Valio Aimo's live data |
| Solving the buyer's need precisely | Filters from the request, cheapest per litre that meets every rule and the date, partial stock kept, substitutes by recipe role |
| Autonomy and controls | Server-side rules, approval queue, signed mandates, signed offers, and the audit history, with adversarial tests in `backend/test/adversarial.test.ts` |
| Robustness to exceptions | Order cut-offs, sales blocks, missing stock, partial availability, and outages of Valio Aimo's APIs |
| Openness and a path to production | Open standards for mandates and signed offers, and an OpenAPI document for every endpoint |

The product data is the organizers' and may be used only within Junction 2026.
