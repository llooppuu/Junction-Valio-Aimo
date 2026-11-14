import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mariadbRepository, type StateRepository } from "../src/persistence/mariadb.js";
import { startSaving } from "../src/persistence/saver.js";
import { restoreStore, serializeStore } from "../src/persistence/snapshot.js";
import type { AuditEntry } from "../src/services/audit.js";
import { AGENT, BUYER, startTestServer, testStore } from "./helpers.js";

/** A repository in memory, recording what was saved. */
function memoryRepository() {
  const saves: { snapshot: string; auditIds: string[] }[] = [];
  const repository: StateRepository & { saves: typeof saves; latest?: string } = {
    saves,
    async load() {
      return repository.latest;
    },
    async save(snapshot: string, entries: readonly AuditEntry[]) {
      repository.latest = snapshot;
      saves.push({ snapshot, auditIds: entries.map((entry) => entry.id) });
    },
    async close() {},
  };
  return repository;
}

const MILK = { productId: "464306", quantity: { amount: 100, unit: "litre" } };

describe("saving and restoring the state", () => {
  it("brings back quotes, orders, mandates, and the audit history after a restart, with signatures that still verify", async () => {
    // Before the restart: a quote, an order, and a narrower mandate.
    const before = testStore();
    const first = await startTestServer({ store: before });
    const quote = await first.request("POST", "/api/quotes", { token: AGENT, body: { lines: [MILK] } });
    const order = await first.request("POST", "/api/orders", { token: AGENT, body: { quoteId: quote.body.quote.id } });
    assert.equal(order.status, 201);
    const mandate = await first.request("POST", "/api/mandates", { token: BUYER, body: { agentId: "demo-agent", allowedCategories: ["milk", "cream"] } });
    assert.equal(mandate.status, 201);
    const saved = serializeStore(before);
    await first.close();

    // After the restart: a fresh store restored from the saved document.
    const after = testStore();
    assert.equal(restoreStore(after, saved), true);
    const second = await startTestServer({ store: after });
    try {
      assert.equal((await second.request("GET", `/api/quotes/${quote.body.quote.id}`, { token: BUYER })).body.quote.status, "ordered");
      assert.equal((await second.request("GET", `/api/orders/${order.body.order.id}`, { token: BUYER })).status, 200);
      const audit = await second.request("GET", "/api/audit", { token: BUYER });
      assert.ok(audit.body.entries.some((entry: { action: string }) => entry.action === "order.placed"));

      // The buyer's mandate still verifies with the restored key, and the agent still acts under it.
      const verified = await second.request("POST", "/api/mandates/verify", { body: { token: mandate.body.mandate.token } });
      assert.equal(verified.body.valid, true, JSON.stringify(verified.body));
      const offer = await second.request("POST", "/api/offers/verify", { body: { token: quote.body.quote.offer.token } });
      assert.equal(offer.body.valid, true);
      const next = await second.request("POST", "/api/quotes", { token: AGENT, body: { lines: [MILK] } });
      assert.equal(next.status, 201);
      assert.equal(next.body.quote.id, "Q-0002", "numbering carries on where it stopped");
    } finally {
      await second.close();
    }
  });

  it("marks an agent run cut off by the restart as failed and frees its conversation", () => {
    const before = testStore();
    before.agent.runs.set("R-0001", {
      id: "R-0001",
      conversationId: "C-0001",
      model: "test",
      agent: { id: "demo-agent", name: "Hotel chain purchasing agent" },
      request: "Order milk",
      language: "en",
      status: "running",
      startedAt: new Date().toISOString(),
      steps: [],
    });
    before.agent.conversations.set("C-0001", { id: "C-0001", agentId: "demo-agent", running: true });
    const after = testStore();
    restoreStore(after, serializeStore(before));
    assert.equal(after.agent.runs.get("R-0001")?.status, "failed");
    assert.equal(after.agent.conversations.get("C-0001")?.running, false);
  });

  it("refuses a document from another version without changing anything", () => {
    const store = testStore();
    const document = JSON.parse(serializeStore(store));
    document.version = 999;
    assert.equal(restoreStore(store, JSON.stringify(document)), false);
  });

  it("saves only when something changed, and appends each audit entry once", async () => {
    const store = testStore();
    const repository = memoryRepository();
    const persistence = startSaving(store, repository, { intervalMs: 60_000 });
    const server = await startTestServer({ store });
    try {
      await persistence.flush();
      assert.equal(repository.saves.length, 0, "nothing changed yet");

      await server.request("POST", "/api/quotes", { token: AGENT, body: { lines: [MILK] } });
      await persistence.flush();
      assert.equal(repository.saves.length, 1);
      const firstIds = repository.saves[0]!.auditIds;
      assert.ok(firstIds.length > 0);

      await persistence.flush();
      assert.equal(repository.saves.length, 1, "an unchanged store is not saved again");

      await server.request("POST", "/api/quotes", { token: AGENT, body: { lines: [{ productId: "463982", quantity: { amount: 1, unit: "package" } }] } });
      await persistence.flush();
      assert.equal(repository.saves.length, 2);
      assert.ok(repository.saves[1]!.auditIds.every((id) => !firstIds.includes(id)), "earlier entries are not appended twice");
    } finally {
      await server.close();
      await persistence.stop();
    }
  });
});

// Runs against a real MariaDB when one is given, for example from docker compose.
const databaseUrl = process.env.TTA_TEST_DATABASE_URL;
describe("MariaDB", { skip: databaseUrl ? false : "set TTA_TEST_DATABASE_URL to run against a real MariaDB" }, () => {
  it("saves the snapshot, reads it back, and keeps the audit history in its own table", async () => {
    const repository = await mariadbRepository(databaseUrl!, { attempts: 5 });
    try {
      const store = testStore();
      const server = await startTestServer({ store });
      await server.request("POST", "/api/quotes", { token: AGENT, body: { lines: [MILK] } });
      await server.close();

      await repository.save(serializeStore(store), store.audit);
      const loaded = await repository.load();
      assert.ok(loaded);
      const restored = testStore();
      assert.equal(restoreStore(restored, loaded), true);
      assert.equal(restored.quotes.size, 1);
      assert.equal(restored.audit.length, store.audit.length);
    } finally {
      await repository.close();
    }
  });
});
