import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { executeTool } from "../src/agent/tools.js";
import { trend } from "../src/services/standingOrders.js";
import { AGENT, BUYER, startTestServer, type TestServer } from "./helpers.js";

const SCHOOL = "demo-school-agent-token";
const CHEESE = "476660"; // Valio Emmental red label 2.5 kg grated
const OAT_CREAM = "469094"; // Oddlygood Cooking, which Valio Aimo cannot deliver

describe("scenario: standing order drift detection", () => {
  let server: TestServer;
  beforeEach(async () => {
    server = await startTestServer();
  });
  afterEach(() => server.close());

  const reviews = async (token = BUYER) => (await server.request("GET", "/api/standing-orders", { token })).body.reviews;
  const renew = (token: string, body: object = {}) => server.request("POST", "/api/standing-orders/renew", { token, body });

  it("compares each line and the total with the last eight weeks", async () => {
    const [hotel, school] = await reviews();
    assert.equal(hotel.weeks.length, 8);
    // The kitchens get their weekly delivery on Mondays: the next one, and the eight before it.
    assert.equal(hotel.deliveryDate, "2026-11-16");
    assert.deepEqual([hotel.weeks[0], hotel.weeks.at(-1)], ["2026-09-21", "2026-11-09"]);
    assert.equal(hotel.thresholdPct, 20);

    // The Emmental crept from two packages to three, and the renewal asks for four: 68% above the average.
    const cheese = hotel.lines.find((line: { productId: string }) => line.productId === CHEESE);
    assert.deepEqual(
      (({ history, mean, spread, renewal, changePct, flagged }) => ({ history, mean, spread, renewal, changePct, flagged }))(cheese),
      { history: [2, 2, 2, 2, 2, 3, 3, 3], mean: 2.38, spread: 0.48, renewal: 4, changePct: 68.4, flagged: true },
    );
    assert.equal(hotel.lines.filter((line: { flagged: boolean }) => line.flagged).length, 1);
    // The total, at Valio Aimo's prices today, rises 14.2%: inside the threshold on its own.
    assert.deepEqual((({ mean, renewal, changePct, flagged }) => ({ mean, renewal, changePct, flagged }))(hotel.cost), {
      mean: 26873,
      renewal: 30690,
      changePct: 14.2,
      flagged: false,
    });
    // A line Valio Aimo cannot deliver says so.
    assert.equal(hotel.lines.find((line: { productId: string }) => line.productId === OAT_CREAM).unavailableReason, "Valio Aimo cannot deliver it on any date");
    assert.equal(hotel.flagged, true);
    assert.match(hotel.summary, /Valio Emmental red label e2,5 kg grated: 4 packages against an average of 2\.4 \(\+68\.4%\)/);

    assert.equal(school.flagged, false);
    assert.match(school.summary, /within 20% of the last 8 weeks/);
  });

  it("flags only beyond the threshold, in either direction", () => {
    assert.equal(trend([10, 10, 10, 10], 12).flagged, false);
    assert.equal(trend([10, 10, 10, 10], 12.1).flagged, true);
    assert.equal(trend([10, 10, 10, 10], 7).flagged, true);
    assert.equal(trend([10, 10, 10, 10], 7).changePct, -30);
  });

  it("sends a drifted renewal to the buyer with the trend attached", async () => {
    const { status, body } = await renew(AGENT);
    assert.equal(status, 201);
    const { quote } = body;
    assert.equal(quote.status, "needs_approval");
    // The oat cream Valio Aimo cannot deliver is left out with the reason, instead of failing the renewal.
    assert.deepEqual(body.leftOut, [{ productId: OAT_CREAM, productName: "Oddlygood® Cooking 1 l UHT", reason: "Valio Aimo cannot deliver it on any date" }]);
    assert.equal(quote.totalEurCents, 30690 - 2 * 2550);
    assert.equal(quote.deliveryDate, "2026-11-16");
    const drift = quote.permission.checks.find((check: { rule: string }) => check.rule === "standing_order_drift");
    assert.equal(drift.outcome, "needs_approval");
    // Only the drift holds it back: the total is well within the limit.
    assert.equal(quote.permission.checks.find((check: { rule: string }) => check.rule === "spending_limit").outcome, "passed");
    assert.deepEqual(quote.standingOrder.lines.find((line: { productId: string }) => line.productId === CHEESE).history, [2, 2, 2, 2, 2, 3, 3, 3]);

    // The agent cannot order it alone, and the review is in the audit history.
    assert.equal((await server.request("POST", "/api/orders", { token: AGENT, body: { quoteId: quote.id } })).status, 409);
    const audit = (await server.request("GET", "/api/audit?limit=20", { token: BUYER })).body.entries;
    const reviewed = audit.find((entry: { action: string }) => entry.action === "standing_order.reviewed");
    assert.equal(reviewed.actor.id, "demo-agent");
    assert.match(reviewed.reason, /Drifted more than 20%/);
    assert.match(reviewed.reason, /Left out: Oddlygood® Cooking 1 l UHT \(Valio Aimo cannot deliver it on any date\)/);
  });

  it("lets an unflagged renewal proceed within the agent's permissions", async () => {
    const { body } = await renew(SCHOOL);
    assert.equal(body.quote.status, "within_limit");
    assert.equal(body.quote.permission.checks.find((check: { rule: string }) => check.rule === "standing_order_drift").outcome, "passed");
    assert.equal((await server.request("POST", "/api/orders", { token: SCHOOL, body: { quoteId: body.quote.id } })).status, 201);
  });

  it("keeps each agent to its own kitchen and its planned lines", async () => {
    assert.deepEqual((await reviews(SCHOOL)).map((review: { agentId: string }) => review.agentId), ["school-agent"]);
    // An agent cannot renew another kitchen's order, or send lines of its own.
    assert.equal((await renew(SCHOOL, { agentId: "demo-agent" })).body.quote.createdBy.id, "school-agent");
    assert.equal((await renew(AGENT, { lines: [{ productId: CHEESE, quantity: { amount: 2, unit: "package" } }] })).status, 400);
    // The buyer can renew either kitchen; a person signs it, so it needs no approval.
    const buyer = await renew(BUYER, { agentId: "demo-agent" });
    assert.equal(buyer.body.quote.status, "approved");
  });

  it("gives the agent tools to review and renew", async () => {
    const api = { baseUrl: `${server.baseUrl}/api`, token: AGENT };
    const review = await executeTool(api, "review_standing_order", "{}");
    assert.match(review.summary, /^Drift: Drifted more than 20%/);
    const renewal = await executeTool(api, "renew_standing_order", "{}");
    assert.equal(renewal.httpStatus, 201);
    assert.equal(renewal.quoteId, "Q-0001");
  });
});
