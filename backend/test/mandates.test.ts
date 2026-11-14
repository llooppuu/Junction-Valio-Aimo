import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { verifyMandate } from "../src/services/mandates.js";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start() {
  server = await startTestServer();
  return server;
}

const NEED = { lines: [{ productId: "464306", quantity: { amount: 1000, unit: "litre" } }] };

/** An agent-only route: the catalog itself is public, so it is not a test of the mandate. */
const agentRequest = (headers: Record<string, string> = {}) => server!.request("GET", "/api/alerts", { token: AGENT, headers });

async function hotelMandate() {
  const { body } = await server!.request("GET", "/api/mandates", { token: BUYER });
  return body.mandates.find((mandate: { agentId: string; status: string }) => mandate.agentId === "demo-agent" && mandate.status === "active");
}

function issue(body: object, token = BUYER) {
  return server!.request("POST", "/api/mandates", { token, body: { agentId: "demo-agent", ...body } });
}

/** Changes one claim in a token's payload and keeps the original signature. */
function tamper(token: string, change: (claims: any) => void): string {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
  change(claims);
  return `${header}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
}

describe("buyer-signed mandates", () => {
  it("gives each agent a signed W3C credential that anyone can verify from the token alone", async () => {
    await start();
    const { body } = await server!.request("GET", "/api/mandates", { token: BUYER });
    assert.match(body.issuer, /^did:key:z6Mk/);
    assert.deepEqual(body.mandates.map((mandate: { agentId: string }) => mandate.agentId).toSorted(), ["demo-agent", "school-agent"]);

    const mandate = await hotelMandate();
    assert.equal(mandate.spendingLimitEurCents, 140000);
    const [header] = mandate.token.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString("utf8")).alg, "EdDSA");

    // No credentials: a supplier or another agent can check it.
    const { status, body: check } = await server!.request("POST", "/api/mandates/verify", { body: { token: mandate.token } });
    assert.equal(status, 200);
    assert.equal(check.valid, true);
    assert.equal(check.status, "active");
    assert.equal(check.issuedByBuyer, true);
    assert.equal(check.claims.iss, body.issuer);
    assert.equal(check.claims.sub, "urn:tta:agent:demo-agent");
    assert.deepEqual(check.claims.vc.type, ["VerifiableCredential", "PurchasingMandate"]);
    assert.equal(check.claims.vc.credentialSubject.spendingLimitEurCents, 140000);
  });

  it("detects a mandate whose limit was raised after signing", async () => {
    await start();
    const mandate = await hotelMandate();
    const forged = tamper(mandate.token, (claims) => {
      claims.vc.credentialSubject.spendingLimitEurCents = 10_000_000;
    });
    const { body } = await server!.request("POST", "/api/mandates/verify", { body: { token: forged } });
    assert.equal(body.valid, false);
    assert.match(body.reason, /signature does not match/);
    assert.equal(body.status, "unknown");
  });

  it("refuses an expired mandate and a malformed one", async () => {
    assert.equal(verifyMandate("not-a-token").valid, false);
    // A mandate's validity is checked against the clock, not trusted from the server's list.
    await start();
    const mandate = await hotelMandate();
    const check = verifyMandate(mandate.token, new Date(Date.parse(mandate.expiresAt) + 1000));
    assert.equal(check.valid, false);
    assert.match((check as { reason: string }).reason, /^expired at/);
  });

  it("stops the agent at once when the buyer revokes, and records the refusal", async () => {
    await start();
    assert.equal((await agentRequest()).status, 200);
    const mandate = await hotelMandate();

    const revoked = await server!.request("POST", `/api/mandates/${mandate.id}/revoke`, { token: BUYER });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.mandate.status, "revoked");

    const refused = await agentRequest();
    assert.equal(refused.status, 403);
    assert.match(refused.body.error, new RegExp(`revoked mandate ${mandate.id}`));
    const quote = await server!.request("POST", "/api/quotes", { token: AGENT, body: NEED });
    assert.equal(quote.status, 403);

    const { body: audit } = await server!.request("GET", "/api/audit", { token: BUYER });
    const actions = audit.entries.map((entry: { action: string }) => entry.action);
    assert.ok(actions.includes("mandate.revoked"));
    assert.ok(actions.includes("access.denied"));

    // Revoking twice is refused; a new mandate lets the agent act again.
    assert.equal((await server!.request("POST", `/api/mandates/${mandate.id}/revoke`, { token: BUYER })).status, 409);
    assert.equal((await issue({})).status, 201);
    assert.equal((await agentRequest()).status, 200);
  });

  it("refuses a quote in a category outside the mandate", async () => {
    await start();
    const { status, body } = await issue({ allowedCategories: ["cheese", "eggs"] });
    assert.equal(status, 201);
    assert.equal(body.mandate.id, "M-0003");

    const quote = await server!.request("POST", "/api/quotes", { token: AGENT, body: NEED });
    assert.equal(quote.status, 403);
    assert.match(quote.body.error, /milk is outside the buyer's mandate M-0003, which allows cheese, eggs/);
  });

  it("sends a total above a tighter mandate limit to the buyer, naming the mandate", async () => {
    await start();
    await issue({ spendingLimitEurCents: 100000 });
    const { status, body } = await server!.request("POST", "/api/quotes", { token: AGENT, body: NEED });
    assert.equal(status, 201);
    assert.equal(body.quote.status, "needs_approval");
    const check = body.quote.permission.checks.find((candidate: { rule: string }) => candidate.rule === "mandate");
    assert.equal(check.outcome, "needs_approval");
    assert.match(body.quote.permission.reason, /€1,010.00 is above the €1,000.00 the buyer's mandate M-0003 allows/);
  });

  it("supersedes the previous mandate, and refuses an agent that presents the old one", async () => {
    await start();
    const old = await hotelMandate();
    const { body } = await issue({});
    const superseded = await agentRequest({ "X-Agent-Mandate": old.token });
    assert.equal(superseded.status, 403);
    assert.match(superseded.body.error, new RegExp(`mandate ${old.id} is superseded; the buyer's current mandate is ${body.mandate.id}`));
    const current = await agentRequest({ "X-Agent-Mandate": body.mandate.token });
    assert.equal(current.status, 200);
  });

  it("lets only the buyer issue or revoke, within the policy limit, and shows an agent only its own", async () => {
    await start();
    assert.equal((await issue({}, AGENT)).status, 403);
    const tooHigh = await issue({ spendingLimitEurCents: 200000 });
    assert.equal(tooHigh.status, 422);
    assert.match(tooHigh.body.error, /cannot allow more than the agent's policy limit of €1,400.00/);
    assert.equal((await issue({ agentId: "nobody" })).status, 404);

    const mandate = await hotelMandate();
    assert.equal((await server!.request("POST", `/api/mandates/${mandate.id}/revoke`, { token: AGENT })).status, 403);
    const { body } = await server!.request("GET", "/api/mandates", { token: AGENT });
    assert.deepEqual([...new Set(body.mandates.map((candidate: { agentId: string }) => candidate.agentId))], ["demo-agent"]);
  });
});
