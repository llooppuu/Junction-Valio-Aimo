import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, test } from "node:test";
import type { AgentModel, ModelRequest, ModelTurn } from "../src/agent/model.js";
import { createOpenAiModel } from "../src/agent/openai-model.js";
import { MAX_TOOL_CALLS, agentInstructions } from "../src/agent/runner.js";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

/** One scripted model turn: tool calls to make, or a final reply. */
type Script = (request: ModelRequest, turn: number) => Partial<ModelTurn>;

/** A stand-in for the real model that follows a script and records what it was sent. */
function scriptedModel(script: Script) {
  const requests: ModelRequest[] = [];
  const model: AgentModel = {
    name: "scripted-test-model",
    async respond(request) {
      requests.push(request);
      const turn = requests.length;
      return { text: "", toolCalls: [], continuation: `turn-${turn}`, ...script(request, turn) };
    },
  };
  return { model, requests };
}

function call(name: string, args: object, id = name) {
  return { id, name, arguments: JSON.stringify(args) };
}

const NEED = "I need 1,000 litres of lactose-free milk by Monday";
const REQUIREMENTS = { attributes: ["lactose-free"], deliverBy: "2026-11-16" };

/** The brief's request, played the way a good agent would. */
const prepareQuoteScript: Script = (_request, turn) => {
  if (turn === 1) {
    return {
      toolCalls: [
        call("search_products", { category: "milk", attributes: ["lactose-free"], deliverBy: "2026-11-16", minQuantity: 1000, unit: "litre" }),
      ],
    };
  }
  if (turn === 2) {
    return {
      toolCalls: [
        call("create_quote", {
          lines: [{ productId: "464306", amount: 1000, unit: "litre" }],
          requirements: REQUIREMENTS,
        }),
      ],
    };
  }
  return { text: "Valio Hyvä suomalainen Arki Eila covers all 1,000 L by Monday at €1.01 a litre. Quote Q-0001 is ready." };
};

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function waitForRun(id: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { body } = await server!.request("GET", `/api/agent/runs/${id}`, { token: BUYER });
    if (body.run.status !== "running") return body.run;
    await delay(10);
  }
  throw new Error(`Run ${id} did not finish`);
}

async function startRun(body: object) {
  const response = await server!.request("POST", "/api/agent/runs", { token: BUYER, body });
  assert.equal(response.status, 202, JSON.stringify(response.body));
  return waitForRun(response.body.run.id);
}

describe("AI agent without a model", () => {
  test("reports that it is off and refuses runs, while the catalog still works", async () => {
    server = await startTestServer();

    const status = await server.request("GET", "/api/agent", { token: BUYER });
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, { available: false, model: null });

    const run = await server.request("POST", "/api/agent/runs", { token: BUYER, body: { message: NEED } });
    assert.equal(run.status, 503);
    assert.match(run.body.error, /OPENAI_API_KEY/);

    const products = await server.request("GET", "/api/products");
    assert.equal(products.status, 200);
    assert.ok(products.body.products.length > 0);
  });
});

describe("AI agent runs", () => {
  test("only the buyer can start or read runs", async () => {
    server = await startTestServer({ agentModel: scriptedModel(prepareQuoteScript).model });

    assert.equal((await server.request("POST", "/api/agent/runs", { body: { message: NEED } })).status, 401);
    assert.equal(
      (await server.request("POST", "/api/agent/runs", { token: AGENT, body: { message: NEED } })).status,
      403,
    );
    assert.equal((await server.request("GET", "/api/agent/runs", { token: AGENT })).status, 403);
  });

  test("rejects an empty or unknown request body", async () => {
    server = await startTestServer({ agentModel: scriptedModel(prepareQuoteScript).model });

    const empty = await server.request("POST", "/api/agent/runs", { token: BUYER, body: { message: "  " } });
    assert.equal(empty.status, 400);
    const extra = await server.request("POST", "/api/agent/runs", {
      token: BUYER,
      body: { message: NEED, spendingLimit: 999999 },
    });
    assert.equal(extra.status, 400);
  });

  test("prepares a quote for the brief's request through the API, as the agent", async () => {
    const { model, requests } = scriptedModel(prepareQuoteScript);
    server = await startTestServer({ agentModel: model });

    const status = await server.request("GET", "/api/agent", { token: AGENT });
    assert.deepEqual(status.body, { available: true, model: "scripted-test-model" });

    const run = await startRun({ message: NEED });

    assert.equal(run.status, "completed");
    assert.equal(run.outcome, "quote_ready");
    assert.deepEqual(run.quote, { id: "Q-0001", status: "within_limit", totalEurCents: 101000 });
    assert.match(run.reply, /Arki Eila/);

    const [search, quote] = run.steps;
    assert.equal(search.tool, "search_products");
    assert.equal(search.httpStatus, 200);
    assert.match(search.path, /attributes=lactose-free/);
    assert.match(search.path, /category=milk/);
    assert.match(search.summary, /^\d+ matching: .*464306/);
    assert.equal(quote.tool, "create_quote");
    assert.equal(quote.httpStatus, 201);
    assert.equal(quote.quoteId, "Q-0001");
    // The step carries the server's permission decision and every rule it checked, for the live panel.
    assert.equal(quote.permission.decision, "within_limit");
    assert.deepEqual(
      quote.permission.checks.map((check: { rule: string; outcome: string }) => `${check.rule}:${check.outcome}`),
      ["spending_limit:passed", "daily_limit:passed", "allergens:passed", "required_attributes:passed", "mandate:passed"],
    );
    assert.equal(search.permission, undefined);

    // The model saw the server's real answer, including the permission decision.
    const quoteResult = requests[2]?.toolResults?.[0];
    assert.ok(quoteResult);
    assert.match(quoteResult.output, /"status":"within_limit"/);
    assert.match(quoteResult.output, /"pricePerPackageEurCents":101,/);
    assert.equal(requests[0]?.userMessage, NEED);
    assert.match(requests[0]?.instructions ?? "", /needs_approval, stop/);
    // The agent's "today" is the server's clock, fixed in tests to when the fixture was recorded.
    assert.match(requests[0]?.instructions ?? "", /Today is Friday, 2026-11-13/);

    // The quote was created with the agent's own credentials, not the buyer's.
    const { body } = await server.request("GET", "/api/quotes/Q-0001", { token: BUYER });
    assert.equal(body.quote.createdBy.id, "demo-agent");
    assert.deepEqual(body.quote.requirements, REQUIREMENTS);

    const audit = await server.request("GET", "/api/audit", { token: BUYER });
    const actions = audit.body.entries.map((entry: { action: string }) => entry.action).reverse();
    assert.deepEqual(actions, ["agent.requested", "quote.created", "permission.checked", "agent.finished"]);
    assert.equal(audit.body.entries[0].actor.role, "agent");
  });

  test("the server, not the model, stops an over-limit order and the run ends awaiting approval", async () => {
    const { model } = scriptedModel((_request, turn) => {
      if (turn === 1) {
        return {
          toolCalls: [
            call("create_quote", {
              lines: [
                { productId: "464306", amount: 1500, unit: "litre" },
              ],
              requirements: REQUIREMENTS,
            }),
          ],
        };
      }
      // A misbehaving model tries to order anyway.
      if (turn === 2) return { toolCalls: [call("place_order", { quoteId: "Q-0001" })] };
      return { text: "Q-0001 is waiting for your approval." };
    });
    server = await startTestServer({ agentModel: model });

    const run = await startRun({ message: "Order 1,000 L of lactose-free milk by Monday" });

    assert.equal(run.status, "completed");
    assert.equal(run.outcome, "awaiting_approval");
    assert.deepEqual(run.quote, { id: "Q-0001", status: "needs_approval", totalEurCents: 151500 });
    const order = run.steps[1];
    assert.equal(order.tool, "place_order");
    assert.equal(order.httpStatus, 409);
    assert.equal(order.ok, false);
    assert.match(order.summary, /waiting for the buyer's approval/);

    const orders = await server.request("GET", "/api/orders", { token: BUYER });
    assert.deepEqual(orders.body.orders, []);
  });

  test("a price or permission the model makes up is refused by the API", async () => {
    const { model } = scriptedModel((_request, turn) =>
      turn === 1
        ? {
            toolCalls: [
              call("create_quote", {
                lines: [{ productId: "464306", amount: 1000, unit: "litre", pricePerPackageEurCents: 1 }],
              }),
              call("set_spending_limit", { eurCents: 99999999 }, "second"),
              call("create_quote", { lines: "not a list" }, "third"),
            ],
          }
        : { text: "I could not do that." },
    );
    server = await startTestServer({ agentModel: model });

    const run = await startRun({ message: NEED });

    // The extra price field is dropped by the tool layer, so the server's own price applies.
    assert.equal(run.steps[0].httpStatus, 201);
    const { body } = await server.request("GET", "/api/quotes/Q-0001", { token: BUYER });
    assert.equal(body.quote.totalEurCents, 101000);
    assert.equal(run.steps[1].httpStatus, 0);
    assert.match(run.steps[1].summary, /no tool called "set_spending_limit"/);
    assert.equal(run.steps[2].httpStatus, 400);
  });

  test("a blocked quote shows the rule that blocked it in the step", async () => {
    const { model } = scriptedModel((_request, turn) =>
      turn === 1
        ? {
            toolCalls: [
              call("create_quote", { lines: [{ productId: "464306", amount: 60, unit: "litre" }] }),
            ],
          }
        : { text: "Lactose-free milk still contains milk, so I cannot order it." },
    );
    server = await startTestServer({ agentModel: model });

    const run = await startRun({ message: "Order lactose-free milk", agentId: "school-agent" });

    const [step] = run.steps;
    assert.equal(step.httpStatus, 422);
    assert.equal(step.permission.decision, "blocked");
    assert.ok(step.permission.checks.some((check: { rule: string; outcome: string }) => check.rule === "allergens" && check.outcome === "blocked"));
    assert.match(step.permission.reason, /School kitchen's allergen rule/);
  });

  test("a model that keeps calling tools is stopped", async () => {
    const { model } = scriptedModel(() => ({ toolCalls: [call("get_my_policy", {})] }));
    server = await startTestServer({ agentModel: model });

    const run = await startRun({ message: NEED });

    assert.equal(run.status, "failed");
    assert.match(run.error, new RegExp(`stopped after ${MAX_TOOL_CALLS} tool calls`));
    assert.equal(run.steps.length, MAX_TOOL_CALLS);
  });

  test("a model error fails the run and is recorded", async () => {
    const model: AgentModel = {
      name: "broken",
      respond: async () => {
        throw new Error("upstream unavailable");
      },
    };
    server = await startTestServer({ agentModel: model });

    const run = await startRun({ message: NEED });

    assert.equal(run.status, "failed");
    assert.match(run.error, /upstream unavailable/);
    const audit = await server.request("GET", "/api/audit", { token: BUYER });
    assert.equal(audit.body.entries[0].action, "agent.finished");
    assert.match(audit.body.entries[0].reason, /upstream unavailable/);
  });

  test("a follow-up continues the same conversation", async () => {
    const { model, requests } = scriptedModel(prepareQuoteScript);
    server = await startTestServer({ agentModel: model });

    const first = await startRun({ message: NEED });
    const second = await startRun({ message: "Thanks", conversationId: first.conversationId });

    assert.equal(second.conversationId, first.conversationId);
    assert.equal(requests[0]?.continuation, undefined);
    assert.equal(requests[3]?.continuation, "turn-3");
    assert.equal(requests[3]?.userMessage, "Thanks");

    const unknown = await server.request("POST", "/api/agent/runs", {
      token: BUYER,
      body: { message: "Hi", conversationId: "C-9999" },
    });
    assert.equal(unknown.status, 404);
  });

  test("a demo reset stops runs in progress and clears them", async () => {
    let release: () => void = () => {};
    const model: AgentModel = {
      name: "slow",
      respond: (request) =>
        new Promise((resolve, reject) => {
          release = () => resolve({ text: "done", toolCalls: [], continuation: "x" });
          request.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    server = await startTestServer({ agentModel: model });

    const started = await server.request("POST", "/api/agent/runs", { token: BUYER, body: { message: NEED } });
    assert.equal(started.status, 202);
    assert.equal(started.body.run.status, "running");

    await server.request("POST", "/api/demo/reset", { token: BUYER });
    release();

    const runs = await server.request("GET", "/api/agent/runs", { token: BUYER });
    assert.deepEqual(runs.body.runs, []);
  });
});

describe("cancelling a run", () => {
  test("the buyer can stop the agent mid-run, and the conversation can carry on", async () => {
    // Turn 1 reads the policy; turn 2 "thinks" until it is cancelled; later turns reply at once.
    let turns = 0;
    const model: AgentModel = {
      name: "slow-test-model",
      async respond(request) {
        turns++;
        if (turns === 1) return { text: "", toolCalls: [call("get_my_policy", {})], continuation: "turn-1" };
        if (turns === 2) {
          await new Promise<void>((_resolve, reject) => {
            request.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
        return { text: "Done.", toolCalls: [], continuation: `turn-${turns}` };
      },
    };
    server = await startTestServer({ agentModel: model });

    const started = await server.request("POST", "/api/agent/runs", { token: BUYER, body: { message: NEED } });
    const id = started.body.run.id;
    for (let i = 0; i < 100 && turns < 2; i++) await delay(10);

    const cancelled = await server.request("POST", `/api/agent/runs/${id}/cancel`, { token: BUYER });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.run.status, "cancelled");

    await delay(50);
    const after = await server.request("GET", `/api/agent/runs/${id}`, { token: BUYER });
    assert.equal(after.body.run.status, "cancelled", "the abandoned model call does not turn it into a failure");
    assert.equal(after.body.run.steps.length, 1, "the agent took no step after the cancel");

    assert.equal((await server.request("POST", `/api/agent/runs/${id}/cancel`, { token: BUYER })).status, 409);
    assert.equal((await server.request("POST", `/api/agent/runs/R-9999/cancel`, { token: BUYER })).status, 404);
    assert.equal((await server.request("POST", `/api/agent/runs/${id}/cancel`, { token: AGENT })).status, 403);

    const audit = await server.request("GET", "/api/audit", { token: BUYER });
    const entry = audit.body.entries.find((candidate: { action: string }) => candidate.action === "agent.cancelled");
    assert.ok(entry, "the cancel is in the audit history");
    assert.equal(entry.actor.role, "buyer");
    assert.match(entry.fi.summary, /peruttiin/);

    const followUp = await startRun({ message: "Never mind, just read my policy.", conversationId: started.body.run.conversationId });
    assert.equal(followUp.status, "completed");
  });
});

describe("agent configuration", () => {
  test("the model name is public but the API key never leaves the server", async () => {
    const secret = "sk-test-do-not-leak-0123456789";
    server = await startTestServer({
      agentModel: createOpenAiModel({ apiKey: secret, model: "gpt-5.5", reasoningEffort: "low" }),
    });

    const response = await fetch(`${server.baseUrl}/api/agent`, {
      headers: { Authorization: `Bearer ${BUYER}` },
    });
    const text = await response.text();
    assert.equal(JSON.parse(text).model, "gpt-5.5");
    assert.ok(!text.includes(secret));
  });

  test("replies in the buyer's language", async () => {
    const { model, requests } = scriptedModel(prepareQuoteScript);
    server = await startTestServer({ agentModel: model });

    const finnish = await startRun({ message: "Tarvitsen 1 000 litraa laktoositonta maitoa maanantaiksi", language: "fi" });
    assert.equal(finnish.language, "fi");
    assert.match(requests[0]?.instructions ?? "", /Write your reply in Finnish \(suomeksi\)/);
    assert.match(agentInstructions("2026-11-08", "Hotel chain purchasing agent"), /Write your reply in English\./);

    const unknown = await server.request("POST", "/api/agent/runs", { token: BUYER, body: { message: NEED, language: "sv" } });
    assert.equal(unknown.status, 400);
  });

  test("the instructions resolve relative dates from today", () => {
    const instructions = agentInstructions("2026-11-08", "Hotel chain purchasing agent");
    assert.match(instructions, /Today is Sunday, 2026-11-08/);
    assert.match(instructions, /Never split or shrink an order to avoid approval/);
    assert.match(instructions, /Excluded allergens are hard rules/);
    assert.match(instructions, /Lactose-free is not milk-free/);
  });
});
