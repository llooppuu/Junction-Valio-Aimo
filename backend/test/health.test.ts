import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestServer, type TestServer } from "./helpers.js";

describe("GET /api/health", () => {
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(() => server.close());

  it("reports that the backend is running", async () => {
    const { status, body } = await server.request("GET", "/api/health");
    assert.equal(status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.service, "trusted-trade-agents-backend");
    assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
  });

  it("returns a JSON 404 for unknown API paths", async () => {
    const { status, body } = await server.request("GET", "/api/does-not-exist");
    assert.equal(status, 404);
    assert.deepEqual(body, { error: "Not found" });
  });
});
