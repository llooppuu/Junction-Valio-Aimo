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

Open <http://localhost:8080>. The image sets `PORT=8080` and `FRONTEND_DIST`; most platforms set `PORT` themselves, and the server listens on it.

## Configuration

Set these as environment variables on the platform. Never bake them into the image.

| Variable | Required | Purpose |
| --- | --- | --- |
| `VALIO_API_KEY` | Yes | Valio Aimo's price and availability APIs, and building the catalog |
| `VALIO_API_URL` | No | `https://junction26.valioaimo.fi` by default |
| `OPENAI_API_KEY` | For the AI agent | Without it the agent is off and everything else still works |
| `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | No | `gpt-5.5` and `low` by default |
| `GEMINI_API_KEY` | For voice input | Without it the microphone button is hidden and typing works as before |
| `GEMINI_LIVE_MODEL` | No | `gemini-3.5-transcribe-live` by default; any Gemini Live model works |
| `AGENT_TOKEN`, `SCHOOL_AGENT_TOKEN`, `BUYER_TOKEN`, `WHOLESALER_TOKEN` | Yes, when exposed | Set your own values of at least 8 characters before the app is reachable from the internet |
| `PORT` | Set by the image | The port to listen on; platforms usually set it |
| `FRONTEND_DIST` | Set by the image | Where the built frontend is; when set, the server serves it and adds the demo tokens to browser requests |

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

- **The browser app acts as the buyer.** In production, the server adds the buyer's token to browser requests without a token of their own (and the wholesaler's under `/api/wholesaler`), as the development proxy does. Anyone who can open the app can act as the head chef. For a public demo that is intended; for real use, put the app behind the buyer organization's sign-in.
- **Agents keep their own tokens.** A request that brings its own bearer token keeps it, so an external agent is always treated as an agent.
- **Keys stay on the server.** The Valio Aimo, OpenAI, and Gemini keys are read only by the backend and never sent to a browser or an agent. For voice input the browser gets a single-use Gemini token that opens one session.
- **Serve over HTTPS.** Platforms terminate TLS in front of the container; a virtual machine needs a reverse proxy that does. Browsers also allow the microphone only on `https://` pages and on `localhost`.
- **State resets on restart.** Quotes, orders, and the audit history are in memory, so a restart starts the demo over. See [the path to production](standards-and-production.md#path-to-production).

## Without Docker

```bash
npm install
npm run data       # needs VALIO_API_KEY in .env
npm run build
FRONTEND_DIST=frontend/dist npm run start --workspace backend
```

The server then serves the API and the built frontend on `PORT`, or on `BACKEND_PORT` (3001) when `PORT` is not set.
