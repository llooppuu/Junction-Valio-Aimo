import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { RecordedValio } from "../src/services/valio.js";
import { AGENT, recordedValio, startTestServer, testStore, type TestServer } from "./helpers.js";

interface Alternative {
  supplier: string;
  productId: string;
  verdict: string;
  reason: string;
}

describe("the alternatives behind each quote", () => {
  let server: TestServer;
  let valio: RecordedValio;
  beforeEach(async () => {
    valio = recordedValio();
    server = await startTestServer({ store: testStore({ valio }) });
  });
  afterEach(() => server.close());

  // Loosely typed, like the other test responses, so a missing entry fails the assertion rather than the typecheck.
  const byProduct = (alternatives: Alternative[]): Record<string, any> => Object.fromEntries(alternatives.map((alternative) => [alternative.productId, alternative]));

  it("records the close alternatives with a verdict and reason each", async () => {
    const { body } = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: { lines: [{ productId: "464306", quantity: { amount: 1000, unit: "litre" } }], requirements: { attributes: ["lactose-free"], deliverBy: "2026-11-16" } },
    });
    const a = byProduct(body.quote.alternatives);
    assert.equal(a["464306"].reason, "Chosen: 1000 packages (1,000 L) at €1.01 per litre, delivering Mon 16 Nov");
    assert.equal(
      a["464201"].reason,
      "Not chosen: meets every requirement and could cover all 1,000 L, but €0.55 more per litre than Valio Hyvä suomalainen Arki® Eila® semi skimmed milk drink 1 l lactose free",
    );
    assert.equal(a["469363"].reason, "Not chosen: only 384 packages (384 L) in stock, 1000 needed for 1,000 L");
    assert.equal(a["463038"].reason, "Excluded: the order cut-off for delivery on 2026-11-16 was Thursday 12 November at 15:00");
    // Close alternatives only: Valio Aimo's own substitutes and similar milks, at most ten.
    assert.ok(body.quote.alternatives.length <= 11);
    assert.ok(body.quote.alternatives.every((alternative: Alternative & { productName: string }) => /milk/i.test(alternative.productName)));
  });

  it("explains a split quote's rejected option against the marginal choice", async () => {
    await server.request("POST", "/api/quotes", { token: AGENT, body: { lines: [{ productId: "470863", quantity: { amount: 1000, unit: "litre" } }] } });
    valio.setAvailability("470863", { availableAmount: 600 });
    await server.request("POST", "/api/quotes/Q-0001/recheck", { token: AGENT });
    const replacement = await server.request("POST", "/api/quotes", {
      token: AGENT,
      body: {
        replacesQuoteId: "Q-0001",
        lines: [
          { productId: "470863", quantity: { amount: 600, unit: "package" } },
          { productId: "461174", quantity: { amount: 400, unit: "litre" } },
        ],
      },
    });
    const a = byProduct(replacement.body.quote.alternatives);
    assert.equal(a["461174"].verdict, "chosen");
    assert.match(a["464226"].reason, /^Not chosen: (could cover|meets every requirement)/);
    assert.equal(a["470889"].reason, "Not chosen: only 249 packages (249 L) in stock, 1001 needed for 1,000.5 L");
  });

  it("names the policy's rule when it excludes an alternative, and says why others cannot be delivered", async () => {
    const school = await server.request("POST", "/api/quotes", {
      token: "demo-school-agent-token",
      body: { lines: [{ productId: "468465", quantity: { amount: 24, unit: "litre" } }] },
    });
    const a = byProduct(school.body.quote.alternatives);
    assert.equal(a["470863"].reason, "Not chosen: meets every requirement and could cover all 24 L, but €0.23 more per litre than Oddlygood® oat drink 1l UHT gluten free");
    assert.equal(a["472974"].reason, "Excluded: Valio Aimo cannot deliver it on any date");
    assert.match(a["474724"].reason, /^Excluded: the order cut-off for delivery on 2026-11-16 was Thursday 12 November at 15:00/);
  });
});
