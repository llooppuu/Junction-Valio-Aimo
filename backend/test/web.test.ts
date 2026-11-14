import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { AGENT, startTestServer, type TestServer } from "./helpers.js";

/**
 * Production hosting: one process serves the API and the built frontend, and
 * gives browser requests the demo tokens the Vite proxy adds in development.
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

  it("acts as the buyer for a browser request without a token", async () => {
    const { status, body } = await server.request("GET", "/api/policy");
    assert.equal(status, 200);
    assert.equal(body.policies.length, 2, "the buyer sees both kitchens' policies");
  });

  it("acts as the wholesaler under /api/wholesaler", async () => {
    const { status } = await server.request("GET", "/api/wholesaler/activity");
    assert.equal(status, 200);
  });

  it("keeps a caller's own token, so an agent stays an agent", async () => {
    const { body } = await server.request("GET", "/api/policy", { token: AGENT });
    assert.deepEqual(body.policies.map((policy: { agentId: string }) => policy.agentId), ["demo-agent"]);
    const { status } = await server.request("GET", "/api/wholesaler/activity", { token: AGENT });
    assert.equal(status, 403);
  });
});
