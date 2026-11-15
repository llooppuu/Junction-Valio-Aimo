# Deployment

The app runs as one Docker container: the Express API under `/api` and the built frontend on every other path, on one port. It runs on any platform that runs container images, such as Render, Railway, Fly.io, Azure Container Apps, or a virtual machine.

## Build the image

The backend needs Valio Aimo's product catalog. The recommended way builds it into the image, with the API key passed as a BuildKit secret so it is never stored in an image layer:

```bash
export VALIO_API_KEY=...        # the challenge key
docker build --secret id=valio_api_key,env=VALIO_API_KEY -t trusted-trade-agents .
```

Without the secret, the image builds without the catalog, and the container builds it on its first start from the `VALIO_API_KEY` environment variable. That takes about a minute and about 1 GB of memory, so building it into the image is better on small instances.

## Run it

```bash
docker run --env-file .env -p 8080:8080 trusted-trade-agents
```

Open <http://localhost:8080/login?key=YOUR_DEMO_ACCESS_KEY>. The image sets `PORT=8080` and `FRONTEND_DIST`; most platforms set `PORT` themselves, and the server listens on it.

## With MariaDB

`docker compose up --build` starts the app and a MariaDB database next to it, with `DATABASE_URL` set between them ([docker-compose.yml](../docker-compose.yml)). On a platform, run any MariaDB (or a managed one) and set `DATABASE_URL` on the app.

With a database, the app saves its state whenever it changes and restores it on start: quotes, orders, mandates, earned autonomy, agent runs and conversations, plans, alerts, suggestions, and the counters that number them, together with the signing keys, so offers and mandates signed before a restart still verify. Every audit entry is also appended to its own `tta_audit` table, which keeps the history across demo resets and can be read with plain SQL:

```bash
docker compose exec mariadb mariadb -utta -p tta -e "SELECT at, action, quote_id, summary FROM tta_audit ORDER BY seq DESC LIMIT 10"
```

An agent run that a restart cut off is marked failed, and its conversation carries on with the next request.

## Configuration

Set these as environment variables on the platform. Never bake them into the image.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VALIO_API_KEY` | Yes | Valio Aimo's price and availability APIs, and building the catalog |
| `VALIO_API_URL` | No | `https://junction26.valioaimo.fi` by default |
| `DATABASE_URL` | No | MariaDB, `mariadb://user:password@host:3306/database`. Without it, the state lives in memory and a restart starts over |
| `GEMINI_API_KEY` | For the AI agent and voice input | Runs the agent, reads list photos, embeds search queries, and transcribes speech. Without it (or an OpenAI key) the agent is off and everything else still works |
| `GEMINI_MODEL`, `GEMINI_REASONING_EFFORT` | No | `gemini-3.8-flash` and `low` by default |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | No | Or OpenAI for the agent, photos, and search; `gpt-5.5` by default |
| `AI_PROVIDER` | No | `gemini` or `openai`, when both keys are set. Without it, OpenAI is used when its key is set |
| `GEMINI_LIVE_MODEL` | No | `gemini-3.5-transcribe-live` by default; any Gemini Live model works |
| `AGENT_TOKEN`, `SCHOOL_AGENT_TOKEN`, `BUYER_TOKEN`, `WHOLESALER_TOKEN` | Yes, when exposed | Set your own values of at least 8 characters before the app is reachable from the internet |
| `PORT` | Set by the image | The port to listen on; platforms usually set it |
| `FRONTEND_DIST` | Set by the image | Where the built frontend is; when set, the server serves it |
| `DEMO_ACCESS_KEY` | Yes | The secret in the access link, at least 16 characters. The server will not start without it |

## Health check

`GET /api/health` answers `200` when the server is up. The image has a Docker health check that uses it, with a start period long enough for a first-start catalog build.

## Check it before the demo

`npm run smoke` checks a running app from your own machine, and only reads, so the demo's state is untouched:

```bash
npm run smoke -- https://your-app.example.com
```

```text
ok   Service is up                      HTTP 200
ok   OpenAPI contract                   OpenAPI 3.1.0, 52 operations
ok   Offer signing key (JWKS)           OKP/Ed25519
ok   Catalog search                     "maito" finds Valio skimmed milk 1 l lactose free UHT, priced live
ok   Search by meaning                  top: Valio cooking cream alternative 15 % 1 l lactose free
ok   Live offers from Valio Aimo        10 offers, cheapest €1.01/l
ok   Offer signature verifies           valid EdDSA signature
ok   MCP over HTTP                      16 tools
ok   AI agent                           on, gpt-5.5
off  Voice input                        off (no GEMINI_API_KEY)
```

A `FAIL` line exits with an error. `off` marks an optional feature whose key is not set; search by meaning is also `off` until the container has built its index. If the app uses its own demo tokens, set `AGENT_TOKEN` and `BUYER_TOKEN` before running the check.

## Before exposing it publicly

- **The app opens from its access link.** Share `https://your-app.example.com/login?key=<DEMO_ACCESS_KEY>` with the people who should use the demo. Opening it sets a signed, HTTP-only session cookie for 30 days, and only a browser with that cookie acts as the head chef (and as the wholesaler under `/api/wholesaler`). The link can be opened any number of times; change the key to sign everyone out. Anyone else sees a sign-in screen, and a request without a token or the cookie is refused, so leaving out an agent token grants nothing. For real use, replace the link with the buyer organization's sign-in.
- **Agents keep their own tokens.** A request that brings its own bearer token keeps it, so an external agent is always treated as an agent.
- **Keys stay on the server.** The Valio Aimo, OpenAI, and Gemini keys are read only by the backend and never sent to a browser or an agent. For voice input the browser gets a single-use Gemini token that opens one session.
- **Serve over HTTPS.** Platforms terminate TLS in front of the container; a virtual machine needs a reverse proxy that does. Browsers also allow the microphone only on `https://` pages and on `localhost`.
- **Keep the state.** Set `DATABASE_URL` so quotes, orders, and the audit history survive restarts; without it, a restart starts the demo over. The database holds the signing keys too, so restrict who can reach it.

## Without Docker

```bash
npm install
npm run data       # needs VALIO_API_KEY in .env
npm run build
FRONTEND_DIST=frontend/dist npm run start --workspace backend
```

The server then serves the API and the built frontend on `PORT`, or on `BACKEND_PORT` (3001) when `PORT` is not set.
