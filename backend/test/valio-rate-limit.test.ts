import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHttpValio,
  createPacer,
  PACE_MAX_CALLS,
  PACE_WINDOW_MS,
  RATE_LIMIT_BLOCK_MS,
  retryAfterMs,
  ValioRateLimitedError,
} from "../src/services/valio.js";
import { BUYER, startTestServer, testStore } from "./helpers.js";

/**
 * Valio Aimo answers HTTP 429 when a client calls too often, and then blocks
 * it for 30 seconds. The client must wait the block out and carry on, and pace
 * itself so it does not hit the limit in the first place.
 */

const OK_PRICE = { products: [{ productId: "1", quantity: 1, netPriceFound: false, error: false }] };
const OK_STOCK = { timeNow: "2026-11-14T12:00:00+0200", products: [{ productId: "1", salesBlock: false, scheduleLines: [] }] };

/** A fake clock that the client's waits move forward, so no test waits for real. */
function fakeClock() {
  let at = Date.parse("2026-11-14T10:00:00Z");
  const waits: number[] = [];
  return {
    now: () => at,
    sleep: async (ms: number) => {
      waits.push(ms);
      at += ms;
    },
    waits,
  };
}

/** Answers each call with the next status in the script, then with 200. */
function scriptedFetch(statuses: number[], retryAfter?: string) {
  const calls: { path: string; at: number }[] = [];
  let index = 0;
  const impl = async (url: string | URL | Request, _init?: RequestInit, clock?: () => number) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, at: clock?.() ?? 0 });
    const status = statuses[index++] ?? 200;
    if (status === 200) return new Response(JSON.stringify(path === "/api/price" ? OK_PRICE : OK_STOCK), { status: 200 });
    return new Response("{}", { status, headers: retryAfter ? { "Retry-After": retryAfter } : {} });
  };
  return { impl, calls };
}

describe("Valio Aimo's rate limit", () => {
  it("waits out the 30-second block after a 429, then carries on", async () => {
    const clock = fakeClock();
    const fetch = scriptedFetch([429]);
    const valio = createHttpValio({
      apiKey: "test",
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: ((url: string, init?: RequestInit) => fetch.impl(url, init, clock.now)) as typeof globalThis.fetch,
    });
    const started = clock.now();
    const answer = await valio.lookup(["1"], "2026-11-16");
    assert.ok(answer.prices.has("1"));
    assert.equal(valio.stats.rateLimited, 1);
    // The retried call starts only after the block has ended.
    const retried = fetch.calls.filter((call) => call.at - started >= RATE_LIMIT_BLOCK_MS);
    assert.ok(retried.length >= 1, "a call was retried after the block");
    assert.ok(clock.waits.some((ms) => ms >= RATE_LIMIT_BLOCK_MS));
  });

  it("follows Retry-After when Valio Aimo sends it", async () => {
    assert.equal(retryAfterMs("12", 0), 12_000);
    assert.equal(retryAfterMs(new Date(5_000).toUTCString(), 0), 5_000);
    assert.equal(retryAfterMs(null, 0), RATE_LIMIT_BLOCK_MS);
    assert.equal(retryAfterMs("not a time", 0), RATE_LIMIT_BLOCK_MS);
  });

  it("pauses every call during a block, not just the one that hit it", async () => {
    const clock = fakeClock();
    // The price call is limited once; the availability call, made at the same time, must also wait.
    const fetch = scriptedFetch([429], "20");
    const valio = createHttpValio({
      apiKey: "test",
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: ((url: string, init?: RequestInit) => fetch.impl(url, init, clock.now)) as typeof globalThis.fetch,
    });
    const started = clock.now();
    await valio.lookup(["1"], "2026-11-16");
    const afterBlock = fetch.calls.filter((call) => call.at - started >= 20_000);
    assert.ok(afterBlock.length >= 1);
    assert.equal(valio.stats.blockedUntil, undefined, "the block is cleared once a call succeeds");
  });

  it("gives up after waiting out repeated blocks, and says when to try again", async () => {
    const clock = fakeClock();
    const fetch = scriptedFetch([429, 429, 429, 429, 429, 429]);
    const valio = createHttpValio({
      apiKey: "test",
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl: ((url: string, init?: RequestInit) => fetch.impl(url, init, clock.now)) as typeof globalThis.fetch,
    });
    await assert.rejects(valio.lookup(["1"], "2026-11-16"), (error: unknown) => {
      assert.ok(error instanceof ValioRateLimitedError);
      assert.ok(error.retryAfterSeconds > 0);
      assert.match(error.message, /rate limited, try again in \d+ s/);
      return true;
    });
  });

  it("paces itself: no more than the allowed number of calls start in any window", async () => {
    const clock = fakeClock();
    const pacer = createPacer({ now: clock.now, sleep: clock.sleep });
    const starts: number[] = [];
    for (let call = 0; call < PACE_MAX_CALLS * 3; call++) {
      await pacer.turn();
      starts.push(clock.now());
    }
    for (const start of starts) {
      const inWindow = starts.filter((at) => at >= start && at < start + PACE_WINDOW_MS).length;
      assert.ok(inWindow <= PACE_MAX_CALLS, `${inWindow} calls started within one window`);
    }
    // The first window's calls start at once; only the calls beyond it wait.
    assert.equal(starts[PACE_MAX_CALLS - 1], starts[0]);
    assert.equal(starts[PACE_MAX_CALLS]! - starts[0]!, PACE_WINDOW_MS);
  });

  it("starts no call while a block lasts", async () => {
    const clock = fakeClock();
    const pacer = createPacer({ now: clock.now, sleep: clock.sleep });
    const blockEnds = clock.now() + RATE_LIMIT_BLOCK_MS;
    pacer.blockUntil(blockEnds);
    await pacer.turn();
    assert.equal(clock.now(), blockEnds);
  });
});

describe("the API's answer when Valio Aimo's rate limit persists", () => {
  it("is a 503 with Retry-After, so callers know when to try again", async () => {
    const server = await startTestServer({
      store: testStore({
        valio: {
          stats: { calls: 0, productsRequested: 0, cacheHits: 0, failures: 0, rateLimited: 1 },
          lookup: () => Promise.reject(new ValioRateLimitedError(17)),
        },
      }),
    });
    try {
      const response = await fetch(`${server.baseUrl}/api/products?q=milk`, { headers: { Authorization: `Bearer ${BUYER}` } });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "17");
      const body = (await response.json()) as { error: string; upstream: string };
      assert.equal(body.upstream, "valio-aimo");
      assert.match(body.error, /rate limited/);
    } finally {
      await server.close();
    }
  });
});
