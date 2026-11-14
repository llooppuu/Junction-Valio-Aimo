import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { AgentModel, ModelRequest, ModelTurn } from "../src/agent/model.js";
import type { RecordedValio } from "../src/services/valio.js";
import { BUYER, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

/** The school kitchen's agent token, the default from backend/src/config.ts. */
const SCHOOL = "demo-school-agent-token";
/** Oddlygood oat drink, gluten free and fortified: the school's usual milk alternative. */
const OAT = "468465";

let server: TestServer;
let valio: RecordedValio;
afterEach(() => server.close());

async function start(options: object = {}) {
  valio = recordedValio();
  server = await startTestServer({ store: testStore({ valio }), ...options });
}

/** Valio Aimo has none left for the delivery date. */
function runOut(productId: string) {
  valio.setAvailability(productId, { availableAmount: 0 });
}

async function substitutes(token?: string, extra = "") {
  const { status, body } = await server.request("GET", `/api/substitutes?productId=${OAT}&amount=60&unit=litre${extra}`, {
    ...(token ? { token } : {}),
  });
  assert.equal(status, 200, JSON.stringify(body));
  return body;
}

describe("scenario: allergen-safe substitution under pressure", () => {
  beforeEach(() => start());

  it("gives the school kitchen a milk-free policy with a calcium rule for drinks", async () => {
    const { body } = await server.request("GET", "/api/policy", { token: SCHOOL });
    assert.equal(body.policies.length, 1);
    assert.deepEqual(body.policies[0].excludedAllergens, ["milk"]);
    assert.deepEqual(body.policies[0].nutritionMinimums, { "plant-based": { calciumMg: 100, appliesTo: ["drink", "juoma"] } });
  });

  it("never proposes lactose-free milk, because it still contains milk protein", async () => {
    runOut(OAT);
    const result = await substitutes(SCHOOL);

    assert.deepEqual(result.policy, { agentId: "school-agent", buyerName: "School kitchen" });
    assert.deepEqual(result.requested.unmet, ["none available for 2026-11-16", "out of stock"]);
    assert.deepEqual(result.substitutes.map((substitute: { productId: string }) => substitute.productId), ["473609", "470863", "470889"]);
    // Milk products, lactose-free or not, are never even considered for a milk-free kitchen.
    const ids = [...result.substitutes, ...result.excluded].map((item: { productId: string }) => item.productId);
    assert.ok(!ids.includes("464306") && !ids.includes("464201"));
  });

  it("proposes only substitutes that meet the nutrition rule", async () => {
    runOut(OAT);
    const result = await substitutes(SCHOOL);
    // Oatly's organic oat drink declares no calcium, so it would need the buyer's approval.
    assert.ok(!result.substitutes.some((substitute: { productId: string }) => substitute.productId === "460825"));
    const organic = result.excluded.find((item: { productId: string }) => item.productId === "460825");
    assert.match(organic.reasons.join(), /has 0 mg calcium per 100 ml, below the 100 mg minimum, so School kitchen would have to approve it/);
  });

  it("only the school's policy rules out the unfortified organic oat drink", async () => {
    runOut(OAT);
    const anonymous = await substitutes(undefined, "&excludeAllergens=milk");
    assert.equal(anonymous.policy, null);
    // Without the policy it is a candidate, ranked on its merits, not excluded by a rule.
    assert.ok(!anonymous.excluded.some((item: { productId: string }) => item.productId === "460825"));
    const school = await substitutes(SCHOOL);
    assert.ok(school.excluded.some((item: { productId: string }) => item.productId === "460825"));
  });

  it("says to ask a human when no milk-free substitute meets every rule", async () => {
    // Every substitute the school could use runs out at Valio Aimo too.
    runOut(OAT);
    let result = await substitutes(SCHOOL);
    for (let round = 0; round < 10 && result.substitutes.length > 0; round++) {
      for (const substitute of result.substitutes) runOut(substitute.productId);
      result = await substitutes(SCHOOL);
    }
    assert.deepEqual(result.substitutes, []);
    assert.match(result.nextStep, /No product in the catalog meets every rule of School kitchen\. Do not order anything else\. Ask the buyer/);
  });

  it("blocks a quote for lactose-free milk outright, so it can never reach approval", async () => {
    const { status, body } = await server.request("POST", "/api/quotes", {
      token: SCHOOL,
      body: { lines: [{ productId: "464306", quantity: { amount: 60, unit: "litre" } }] },
    });
    assert.equal(status, 422);
    assert.equal(body.blocked, true);
    const queue = await server.request("GET", "/api/quotes", { token: BUYER });
    assert.deepEqual(queue.body.quotes, []);
  });

  it("lets the school agent quote a safe, fortified substitute within its own limit", async () => {
    runOut(OAT);
    const { status, body } = await server.request("POST", "/api/quotes", {
      token: SCHOOL,
      body: {
        lines: [{ productId: "470863", quantity: { amount: 60, unit: "litre" } }],
        requirements: { excludeAllergens: ["milk"] },
      },
    });
    assert.equal(status, 201);
    assert.equal(body.quote.status, "within_limit");
    assert.equal(body.quote.createdBy.id, "school-agent");
    assert.equal(body.quote.permission.limitEurCents, 50000);
  });
});

describe("agent runs for a chosen kitchen", () => {
  function scripted(turns: ((request: ModelRequest) => Partial<ModelTurn>)[]) {
    let turn = 0;
    const model: AgentModel = {
      name: "scripted",
      respond: async (request) => ({ text: "", toolCalls: [], continuation: `c${turn}`, ...(turns[turn++]?.(request) ?? { text: "done" }) }),
    };
    return model;
  }

  async function finish(id: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const { body } = await server.request("GET", `/api/agent/runs/${id}`, { token: BUYER });
      if (body.run.status !== "running") return body.run;
      await delay(10);
    }
    throw new Error("run did not finish");
  }

  it("acts with the school agent's own token and policy, and follow-ups keep that agent", async () => {
    await start({
      agentModel: scripted([
        () => ({
          toolCalls: [
            { id: "1", name: "find_substitutes", arguments: JSON.stringify({ productId: OAT, amount: 60, unit: "litre" }) },
          ],
        }),
        () => ({ text: "The Oddlygood Barista oat drink is the safe choice." }),
        () => ({ text: "Still the school agent." }),
      ]),
    });
    runOut(OAT);

    const started = await server.request("POST", "/api/agent/runs", {
      token: BUYER,
      body: { message: "Our oat drink ran out", agentId: "school-agent" },
    });
    const run = await finish(started.body.run.id);
    assert.deepEqual(run.agent, { id: "school-agent", name: "School kitchen purchasing agent" });
    assert.match(run.steps[0].path, /^\/substitutes\?/);
    assert.match(run.steps[0].summary, /473609/);
    assert.ok(!/464306|464201/.test(run.steps[0].summary), run.steps[0].summary);

    const followUp = await server.request("POST", "/api/agent/runs", {
      token: BUYER,
      body: { message: "Thanks", conversationId: run.conversationId },
    });
    assert.equal((await finish(followUp.body.run.id)).agent.id, "school-agent");

    const switched = await server.request("POST", "/api/agent/runs", {
      token: BUYER,
      body: { message: "Hi", conversationId: run.conversationId, agentId: "demo-agent" },
    });
    assert.equal(switched.status, 409);
    const unknown = await server.request("POST", "/api/agent/runs", { token: BUYER, body: { message: "Hi", agentId: "nobody" } });
    assert.equal(unknown.status, 404);
  });
});
