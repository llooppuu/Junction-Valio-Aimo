/**
 * Checks a running app before a demo: the service, its contract, Valio Aimo's
 * live APIs, signed offers, MCP, and which optional features are on. It only
 * reads, so it never changes the demo's state.
 *
 *   npm run smoke                                 # the local backend, http://localhost:3001
 *   npm run smoke -- https://your-app.example.com # a deployed app
 *
 * The demo tokens default to the demo values; set AGENT_TOKEN and BUYER_TOKEN
 * when the deployed app uses its own.
 */

const baseUrl = (process.argv[2] ?? process.env.SMOKE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const agentToken = process.env.AGENT_TOKEN ?? "demo-agent-token";
const buyerToken = process.env.BUYER_TOKEN ?? "demo-buyer-token";

type Outcome = { ok: boolean; detail: string; optional?: boolean };
let failures = 0;

async function check(name: string, run: () => Promise<Outcome>) {
  const started = performance.now();
  let outcome: Outcome;
  try {
    outcome = await run();
  } catch (error) {
    outcome = { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  const ms = Math.round(performance.now() - started);
  const mark = outcome.ok ? "ok  " : outcome.optional ? "off " : "FAIL";
  if (!outcome.ok && !outcome.optional) failures++;
  console.log(`${mark} ${name.padEnd(34)} ${outcome.detail} (${ms} ms)`);
}

async function get(path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await response.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

/** A delivery date three days ahead in Helsinki, far enough to clear any order cut-off. */
function deliverBy(): string {
  const date = new Date(Date.now() + 3 * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(date);
}

console.log(`Checking ${baseUrl}\n`);

await check("Service is up", async () => {
  const { status, body } = await get("/api/health");
  return { ok: status === 200 && body?.status === "ok", detail: `HTTP ${status}` };
});

await check("OpenAPI contract", async () => {
  const { status, body } = await get("/api/openapi.json");
  const operations = Object.values(body?.paths ?? {}).reduce((sum: number, path: any) => sum + Object.keys(path).length, 0);
  return { ok: status === 200 && String(body?.openapi).startsWith("3.1"), detail: `OpenAPI ${body?.openapi}, ${operations} operations` };
});

await check("Offer signing key (JWKS)", async () => {
  const { status, body } = await get("/.well-known/jwks.json");
  const key = body?.keys?.[0];
  return { ok: status === 200 && key?.crv === "Ed25519", detail: key ? `${key.kty}/${key.crv}, kid ${key.kid}` : `HTTP ${status}` };
});

await check("Catalog search", async () => {
  const { status, body } = await get("/api/products?q=maito&limit=3", agentToken);
  const found = body?.products?.length ?? 0;
  return { ok: status === 200 && found > 0, detail: found ? `"maito" finds ${body.products[0].name}, priced live` : `HTTP ${status}: ${body?.error ?? "nothing found"}` };
});

await check("Search by meaning", async () => {
  const { status, body } = await get(`/api/products?q=${encodeURIComponent("plant-based instead of cream")}&search=semantic&limit=3`, agentToken);
  const semantic = body?.source?.search === "semantic";
  return {
    ok: status === 200 && semantic,
    optional: status === 200,
    detail: semantic ? `top: ${body.products?.[0]?.name ?? "none"}` : `fell back to keywords (${body?.source?.searchFallback ?? `HTTP ${status}`})`,
  };
});

let offerToken: string | undefined;
await check("Live offers from Valio Aimo", async () => {
  const query = new URLSearchParams({ category: "milk", attributes: "lactose-free", deliverBy: deliverBy(), unit: "litre", minQuantity: "1000", rankBy: "price" });
  const { status, body } = await get(`/api/offers?${query}`, agentToken);
  const top = body?.offers?.[0];
  offerToken = top?.product?.offer?.token;
  return {
    ok: status === 200 && !!top,
    detail: top ? `${body.offers.length} offers, cheapest €${(top.unitPriceEurCents / 100).toFixed(2)}/l, ${top.product.name}` : `HTTP ${status}: ${body?.error ?? "no offers"}`,
  };
});

await check("Offer signature verifies", async () => {
  if (!offerToken) return { ok: false, detail: "no offer to verify" };
  const response = await fetch(`${baseUrl}/api/offers/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: offerToken }),
  });
  const body: any = await response.json();
  return { ok: response.status === 200 && body?.valid === true, detail: body?.valid ? "valid EdDSA signature" : `HTTP ${response.status}` };
});

await check("MCP over HTTP", async () => {
  const response = await fetch(`${baseUrl}/api/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const text = await response.text();
  // Streamable HTTP may answer as JSON or as one server-sent event.
  const json = JSON.parse(text.startsWith("{") ? text : (text.match(/^data: (.*)$/m)?.[1] ?? "{}"));
  const tools = json?.result?.tools?.length ?? 0;
  return { ok: response.status === 200 && tools > 0, detail: `${tools} tools` };
});

await check("AI agent", async () => {
  const { status, body } = await get("/api/agent", buyerToken);
  return { ok: status === 200 && body?.available, optional: status === 200, detail: body?.available ? `on, ${body.model}` : "off (no OPENAI_API_KEY)" };
});

await check("Voice input", async () => {
  const { status, body } = await get("/api/voice", buyerToken);
  return { ok: status === 200 && body?.available, optional: status === 200, detail: body?.available ? `on, ${body.model}` : "off (no GEMINI_API_KEY)" };
});

console.log(failures === 0 ? "\nReady for the demo." : `\n${failures} check${failures === 1 ? "" : "s"} failed.`);
process.exit(failures === 0 ? 0 : 1);
