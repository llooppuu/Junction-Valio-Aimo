# Trusted Trade Agents

The interface and operating model that lets a kitchen's AI purchasing agent buy from Valio Aimo: find products, compare offers, order at fixed prices, and get a person's approval when its rules say so. Built at Junction 2026 for the Valio Aimo challenge #327.

It runs on **Valio Aimo's challenge material**: the 17,546-product data file, delivery reliability, carbon footprint, and the live mock **price** and **availability** APIs. Nothing is invented about the products, prices, or stock. The kitchens, their rules, recipes, and order history are ours.

## What it does

- **Lookup, in two steps.** A search runs over Valio Aimo's product data, then only the best matches (20 by default, 50 at most) get live price and availability, as the organizers ask. Every answer is a signed offer that any agent can verify.
- **Inquiry to order at a fixed price.** A quote locks Valio Aimo's price per sales unit and records the delivery date, order cut-off, VAT, and stock status. The order asks Valio Aimo again just before committing, and an order can never be placed twice.
- **Permissions and human approval.** Each kitchen's rules live on the server: spending and daily limits, allergens that block outright, required attributes, labels, nutrition, suppliers, and products without an allergen declaration. Each agent acts under a buyer-signed mandate, a W3C Verifiable Credential that the buyer can revoke at once.
- **Earned autonomy.** An agent starts supervised: a person approves its orders, as Valio Aimo's buyers do today. It earns the right to order alone one product category at a time, after a run of the buyer's approvals and only up to the largest total the buyer approved there. A rejection or a blocked attempt resets the run, and the buyer can grant or revoke any category.
- **Exceptions.** Order cut-offs, sales blocks, products Valio Aimo cannot deliver, partial stock, and supplier-warehouse stock that cannot be confirmed are all handled and explained. Substitutes follow recipe logic: chopped tomatoes can replace cherry tomatoes in a sauce but not in a salad, and salmon can be topped up with salmon, never herring.
- **Traceability.** Every step, refusal, and decision is in an append-only audit history in plain language, for the kitchen and for Valio Aimo.

An AI agent on GPT-5.5 runs the whole flow from a request in plain language, using only the public API with its own credentials. It gets no special treatment. The head chef can type the request or say it: the microphone button beside Send transcribes speech in English or Finnish with Gemini Live, and the words land in the request box to check before sending.

MCP clients can use the interface too: `npm run mcp` starts a local MCP process, and a running app answers MCP at `POST /api/mcp`. Each tool call is forwarded to the REST API with the agent's token, so the same checks apply. See [docs/mcp.md](docs/mcp.md).

## Quick start

You need **Node.js 22.12 or newer** and the challenge's **Valio Aimo API key**.

```bash
npm install
cp .env.example .env        # then set VALIO_API_KEY, and OPENAI_API_KEY for the AI agent
npm run data                # builds backend/data/catalog.json from the organizers' files
npm run dev
```

`npm run data` downloads the organizers' product, reliability, and carbon files with `VALIO_API_KEY` and keeps only the built catalog, which is not in git. Run `npm run embeddings` after it to switch on search by meaning in the catalog; without it, search matches words.

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
| `npm run embeddings` | Builds the index for search by meaning (needs `OPENAI_API_KEY` and the catalog; about a minute) |
| `npm run mcp` | Starts the MCP server over stdio for a local MCP client, using the running API |
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
| `GEMINI_API_KEY` | Turns on voice input in the agent workspace. The key stays on the server; the browser gets a single-use token per request |
| `GEMINI_LIVE_MODEL` | The Gemini Live model that transcribes speech, `gemini-2.5-flash-native-audio-preview-09-2025` by default |
| `AGENT_TOKEN`, `SCHOOL_AGENT_TOKEN`, `BUYER_TOKEN`, `WHOLESALER_TOKEN` | Demo tokens. The AI agents send their own; the Vite proxy adds the buyer's and the wholesaler's |
| `BACKEND_PORT` | The backend's port, 3001 by default |
| `PORT`, `FRONTEND_DIST` | Production hosting: the port the platform gives, and the built frontend the backend then serves itself |

## Deploy with Docker

One container serves the API and the frontend on one port, so it runs on any host that runs Docker images.

```bash
# Build, with Valio Aimo's catalog built into the image. The key is a BuildKit secret, never stored in a layer.
docker build --secret id=valio_api_key,env=VALIO_API_KEY -t trusted-trade-agents .

# Run with your settings as environment variables.
docker run --env-file .env -p 8080:8080 trusted-trade-agents
```

The app is then at <http://localhost:8080>. Without the build secret, the container builds the catalog on its first start from `VALIO_API_KEY`, which needs about 1 GB of memory. The browser app acts as the buyer, so set your own values for the demo tokens before you expose it.

## Project structure

```
backend/         Express API: catalog search, offers, quotes, orders, rules, mandates, audit, the AI agent
  src/           Routes, services, schemas and the agent
  scripts/       Catalog build and fixture tools
  test/          Tests on recorded Valio Aimo answers, including adversarial agents
frontend/        React + Vite buyer and wholesaler app
  src/           Components, helpers and styles
.env.example     Configuration template, copy it to .env
docs/            How it works, the API, trust and controls, scenarios, deployment
Dockerfile       One container for the API and the frontend
package.json     npm workspaces and the root commands
```

## The judges' criteria

| Criterion | Evidence |
| --- | --- |
| Working end-to-end demo | [Scenarios](docs/scenarios.md#the-briefs-milk-request-step-by-step): the brief's request, from plain language to an order on Valio Aimo's live data |
| Solving the buyer's need precisely | Requirements read from the request and checked on the server, the cheapest offer per litre that meets every rule and the date, and every alternative recorded with the reason |
| Autonomy and controls | [Trust and controls](docs/trust-and-controls.md): server-side rules, signed mandates, earned autonomy, the approval queue, the audit history, and eleven adversarial tests |
| Robustness to exceptions | [Valio Aimo integration](docs/valio-integration.md) and [Scenarios](docs/scenarios.md#when-things-go-wrong): cut-offs, sales blocks, unknown and partial availability, changed stock, rate limits, and outages |
| Openness and a path to production | [Standards and the path to production](docs/standards-and-production.md): open standards, every assumption, and next steps |

## Documentation

[docs/](docs/README.md) explains the [architecture](docs/architecture.md), the [API](docs/api.md), [MCP clients](docs/mcp.md), [trust and controls](docs/trust-and-controls.md), the [Valio Aimo integration](docs/valio-integration.md), [demo scenarios](docs/scenarios.md), [standards and the path to production](docs/standards-and-production.md), and [deployment](docs/deployment.md). The full API contract is at `/api/openapi.json`.

The product data is the organizers' and may be used only within Junction 2026.
