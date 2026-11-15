import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { AGENT, startTestServer, TEST_ACCESS_KEY, type TestServer } from "./helpers.js";

/**
 * Production hosting: one process serves the API and the built frontend. Only a
 * browser that opened the access link acts as the buyer; everyone else needs a token.
 */
describe("serving the frontend in production", () => {
  let dist: string;
  let server: TestServer;
  before(async () => {
    dist = mkdtempSync(join(tmpdir(), "tta-dist-"));
    mkdirSync(join(dist, "assets"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><title>Trusted Trade Agents</title>");
    writeFileSync(join(dist, "assets", "app.js"), "console.log('app');");
    server = await startTestServer({ frontendDist: dist });
  });
  after(async () => {
    await server.close();
    rmSync(dist, { recursive: true, force: true });
  });

  /** Opens the access link and returns the session cookie it sets. */
  async function signIn(): Promise<string> {
    const response = await fetch(`${server.baseUrl}/login?key=${TEST_ACCESS_KEY}`, { redirect: "manual" });
    return (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  }

  it("serves the app, its assets, and index.html for client-side paths", async () => {
    const home = await fetch(`${server.baseUrl}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Trusted Trade Agents/);
    const asset = await fetch(`${server.baseUrl}/assets/app.js`);
    assert.equal(asset.status, 200);
    const deep = await fetch(`${server.baseUrl}/some/view`);
    assert.match(await deep.text(), /Trusted Trade Agents/);
  });

  it("keeps unknown API paths as JSON 404s", async () => {
    const { status, body } = await server.request("GET", "/api/no-such-route");
    assert.equal(status, 404);
    assert.equal(body.error, "Not found");
  });

  it("refuses a request without a token or the access cookie, so leaving out an agent token grants nothing", async () => {
    assert.equal((await server.request("GET", "/api/policy")).status, 401);
    assert.equal((await server.request("POST", "/api/demo/reset")).status, 401);
    assert.equal((await server.request("POST", "/api/quotes/Q-0001/decision", { body: { decision: "approve" } })).status, 401);
    assert.equal((await server.request("POST", "/api/mandates", { body: { agentId: "demo-agent" } })).status, 401);
    assert.equal((await server.request("GET", "/api/wholesaler/activity")).status, 401);
    assert.deepEqual((await server.request("GET", "/api/session")).body, { authenticated: false, role: null, accessLink: true });
  });

  it("turns a wrong key away without a cookie", async () => {
    const response = await fetch(`${server.baseUrl}/login?key=wrong-key-wrong-key`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/?access=denied");
    assert.equal(response.headers.get("set-cookie"), null);
  });

  it("signs a browser in with the access link: the buyer, and the wholesaler under /api/wholesaler", async () => {
    const response = await fetch(`${server.baseUrl}/login?key=${TEST_ACCESS_KEY}`, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(";")[0]!;

    const policy = await server.request("GET", "/api/policy", { headers: { Cookie: cookie } });
    assert.equal(policy.status, 200);
    assert.equal(policy.body.policies.length, 2, "the buyer sees both kitchens");
    assert.equal((await server.request("GET", "/api/wholesaler/activity", { headers: { Cookie: cookie } })).status, 200);
    assert.deepEqual((await server.request("GET", "/api/session", { headers: { Cookie: cookie } })).body, {
      authenticated: true,
      role: "buyer",
      accessLink: true,
    });
    // The link can be opened any number of times.
    assert.equal(await signIn(), cookie);
  });

  it("does not accept a forged session cookie", async () => {
    const forged = await server.request("GET", "/api/policy", { headers: { Cookie: "tta_demo_session=forged-value" } });
    assert.equal(forged.status, 401);
  });

  it("keeps a caller's own token, so an agent stays an agent even with the cookie", async () => {
    const cookie = await signIn();
    const { body } = await server.request("GET", "/api/policy", { token: AGENT, headers: { Cookie: cookie } });
    assert.deepEqual(body.policies.map((policy: { agentId: string }) => policy.agentId), ["demo-agent"]);
    const { status } = await server.request("GET", "/api/wholesaler/activity", { token: AGENT });
    assert.equal(status, 403);
  });
});

describe("serving the frontend without an access key", () => {
  it("refuses to start, because nothing would tell the head chef from anyone else", () => {
    assert.throws(() => createApp({ frontendDist: "unused", demoAccessKey: "", agentModel: null, voiceTokens: null }), /DEMO_ACCESS_KEY/);
  });
});
