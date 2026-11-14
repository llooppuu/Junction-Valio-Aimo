import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { executeTool } from "../src/agent/tools.js";
import { currentLaunches } from "../src/services/suggestions.js";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

const SCHOOL = "demo-school-agent-token";
const WHOLESALER = "demo-wholesaler-token";
const LINGON = "473629"; // Polproduct Nordics frozen lingonberry 2.5 kg, seasonal
const QUARK = "463472"; // Valio PROfeel vanilla protein quark, new, contains milk
const CHOCOLATE = "460685"; // Fazer Geisha hazelnut chocolate 3 kg, seasonal, contains milk and nuts

describe("scenario: the wholesaler's proactive selling agent", () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(() => server.close());

  const campaign = () => server.request("POST", "/api/wholesaler/suggestions", { token: WHOLESALER });
  const suggestions = async (token: string, status?: string) =>
    (await server.request("GET", `/api/suggestions${status ? `?status=${status}` : ""}`, { token })).body.suggestions;
  const byProduct = (list: any[], productId: string) => list.find((item) => item.productId === productId);

  it("promotes products launched in the last 60 days or in season", () => {
    assert.deepEqual(currentLaunches("2026-11-13").map((launch) => launch.productId), [LINGON, QUARK, CHOCOLATE]);
    // In spring the lingonberries are out of season and the launches are old news.
    assert.deepEqual(currentLaunches("2027-04-01"), []);
  });

  it("passes only suitable suggestions to each buyer, with a reason", async () => {
    const { status, body } = await campaign();
    assert.equal(status, 201);
    assert.equal(body.sent, 6);

    const hotel = await suggestions(AGENT);
    assert.equal(byProduct(hotel, LINGON).status, "suggested");
    assert.equal(byProduct(hotel, QUARK).status, "suggested");
    assert.match(byProduct(hotel, QUARK).screening.reason, /^Meets every rule of Hotel chain/);
    // The hotel is nut-free, so its agent holds back the hazelnut chocolate.
    assert.equal(byProduct(hotel, CHOCOLATE).status, "held_back");
    assert.match(byProduct(hotel, CHOCOLATE).screening.reason, /contains nuts/);
    // Frozen lingonberries declare no allergens, which the buyer's rules accept for unprocessed produce.
    assert.match(byProduct(hotel, LINGON).screening.reason, /unprocessed fresh produce without an allergen declaration/);

    // The school is milk-free: only the lingonberries reach the buyer.
    const school = await suggestions(SCHOOL, "suggested");
    assert.deepEqual(school.map((item: { productId: string }) => item.productId), [LINGON]);
    assert.match(byProduct(await suggestions(SCHOOL), QUARK).screening.reason, /contains milk/);

    // Each product is suggested to a kitchen once.
    assert.equal((await campaign()).body.sent, 0);
  });

  it("marks the suggestion as wholesaler-initiated in the audit history", async () => {
    await campaign();
    const entries = (await server.request("GET", "/api/audit?limit=50", { token: BUYER })).body.entries;
    const sent = entries.filter((entry: { action: string }) => entry.action === "suggestion.sent");
    assert.equal(sent.length, 6);
    assert.ok(sent.every((entry: { actor: { role: string } }) => entry.actor.role === "wholesaler"));
    assert.match(sent[0].reason, /Wholesaler-initiated/);
    const screened = entries.filter((entry: { action: string }) => entry.action === "suggestion.screened");
    assert.deepEqual([...new Set(screened.map((entry: { actor: { id: string } }) => entry.actor.id))].sort(), ["demo-agent", "school-agent"]);
  });

  it("never orders a suggestion without the buyer's approval", async () => {
    await campaign();
    const lingon = byProduct(await suggestions(AGENT), LINGON);
    // One €18.03 bag, far below the limit, still waits for the buyer.
    const { status, body } = await server.request("POST", `/api/suggestions/${lingon.id}/quote`, { token: AGENT, body: { packages: 1 } });
    assert.equal(status, 201);
    assert.equal(body.quote.status, "needs_approval");
    assert.equal(body.quote.totalEurCents, 1803);
    assert.equal(body.quote.suggestionId, lingon.id);
    assert.equal(body.quote.permission.checks.at(-1).rule, "wholesaler_suggestion");
    assert.equal((await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: body.quote.id } })).status, 409);
    assert.equal(byProduct(await suggestions(AGENT), LINGON).status, "quoted");

    // Once the buyer approves, it can be ordered.
    await server.request("POST", `/api/quotes/${body.quote.id}/decision`, { token: BUYER, body: { decision: "approve" } });
    assert.equal((await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: body.quote.id } })).status, 201);
  });

  it("refuses to quote a held-back suggestion or another kitchen's", async () => {
    await campaign();
    const chocolate = byProduct(await suggestions(AGENT), CHOCOLATE);
    assert.equal((await server.request("POST", `/api/suggestions/${chocolate.id}/quote`, { token: AGENT, body: {} })).status, 409);
    const schoolLingon = byProduct(await suggestions(SCHOOL), LINGON);
    assert.equal((await server.request("POST", `/api/suggestions/${schoolLingon.id}/quote`, { token: AGENT, body: {} })).status, 404);
  });

  it("lets the buyer dismiss a suggestion, and keeps the sales agent to the wholesaler", async () => {
    await campaign();
    const quark = byProduct(await suggestions(AGENT), QUARK);
    assert.equal((await server.request("POST", `/api/suggestions/${quark.id}/dismiss`, { token: BUYER })).body.suggestion.status, "dismissed");
    assert.equal((await server.request("POST", `/api/suggestions/${quark.id}/quote`, { token: AGENT, body: {} })).status, 409);
    // A buyer's agent cannot run the seller's campaign or dismiss on the buyer's behalf.
    assert.equal((await server.request("POST", "/api/wholesaler/suggestions", { token: AGENT })).status, 403);
    assert.equal((await server.request("POST", `/api/suggestions/${quark.id}/dismiss`, { token: AGENT })).status, 403);
  });

  it("gives the buyer's agent tools to read and quote suggestions", async () => {
    await campaign();
    const api = { baseUrl: `${server.baseUrl}/api`, token: SCHOOL };
    const read = await executeTool(api, "get_suggestions", "{}");
    assert.match(read.summary, /^S-\d{4}: 473629$/);
    const id = read.summary.split(":")[0];
    const quoted = await executeTool(api, "quote_suggestion", JSON.stringify({ suggestionId: id, packages: 2 }));
    assert.equal(quoted.httpStatus, 201);
    assert.ok(quoted.quoteId);
  });
});
