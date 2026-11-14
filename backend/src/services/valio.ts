/**
 * The client for Valio Aimo's mock price and availability APIs, used only on
 * the server: the API key never reaches a browser or an agent. Agents call our
 * API, so the buyer's rules, mandates, signed offers, and audit stay in the path.
 *
 * The organizers ask that prices and availability are queried only for
 * products already narrowed down from the static data, so every call names a
 * short list, answers are cached briefly, and each call is counted.
 */

/** One product's price for one delivery date, as `POST /api/price` returns it. */
export interface ValioPrice {
  productId: string;
  quantity: number;
  catalogPrice?: { value: number; valueWithTax: number; validFrom: string; validTo: string; currency: string };
  comparisonPrice?: { value: number; valueWithTax: number; currency: string };
  comparisonUnit?: string;
  tax?: { taxRate: number; taxValue: number };
  listPrice?: { value: number; valueWithTax: number };
  netPriceFound: boolean;
  error: boolean;
}

/** One product's availability, as `POST /api/availability` returns it. */
export interface ValioAvailability {
  productId: string;
  closingTime?: string;
  salesBlock: boolean;
  logisticModel?: string;
  scheduleLines: { salesBlock: boolean; availableAmount: number; availableDate: string; salesUnit: string }[];
}

export interface ValioAnswer {
  /** Valio Aimo's server time when it answered, in Helsinki time. */
  timeNow: string;
  prices: Map<string, ValioPrice>;
  availability: Map<string, ValioAvailability>;
}

export interface ValioStats {
  calls: number;
  productsRequested: number;
  cacheHits: number;
  failures: number;
  lastCallAt?: string;
}

export interface ValioClient {
  /** Price and availability for the named products on one requested delivery date. */
  lookup(productIds: string[], requestedDate: string): Promise<ValioAnswer>;
  readonly stats: ValioStats;
}

export class ValioUnavailableError extends Error {
  constructor(detail: string) {
    super(`Valio Aimo's price and availability service did not answer (${detail}), so nothing was quoted or ordered.`);
  }
}

/** The API rejects longer lists with 422. */
export const VALIO_MAX_PRODUCTS = 1000;
const PRICE_TTL_MS = 5 * 60_000;
const AVAILABILITY_TTL_MS = 60_000;

export interface HttpValioOptions {
  apiKey: string;
  baseUrl?: string;
  /** Not meaningful in the challenge, but the API requires one. */
  customer?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createHttpValio({ apiKey, baseUrl = "https://junction26.valioaimo.fi", customer = "trusted-trade-agents", fetchImpl = fetch, now = Date.now }: HttpValioOptions): ValioClient {
  const stats: ValioStats = { calls: 0, productsRequested: 0, cacheHits: 0, failures: 0 };
  const prices = new Map<string, { at: number; value: ValioPrice }>();
  const stock = new Map<string, { at: number; value: ValioAvailability; timeNow: string }>();

  async function post<T>(path: string, products: string[], requestedDate: string): Promise<T> {
    const body = JSON.stringify({ customer, requestedDate, products });
    for (let attempt = 0; ; attempt++) {
      stats.calls++;
      stats.productsRequested += products.length;
      stats.lastCallAt = new Date(now()).toISOString();
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method: "POST",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
          body,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        if (attempt === 0) continue;
        stats.failures++;
        throw new ValioUnavailableError(error instanceof Error ? error.message : "network error");
      }
      if (response.ok) return (await response.json()) as T;
      // A rate limit or a server error is retried once, after a short pause.
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      stats.failures++;
      throw new ValioUnavailableError(`HTTP ${response.status} from ${path}`);
    }
  }

  async function inBatches<T>(path: string, ids: string[], requestedDate: string): Promise<T[]> {
    const answers: T[] = [];
    for (let start = 0; start < ids.length; start += VALIO_MAX_PRODUCTS) {
      answers.push(await post<T>(path, ids.slice(start, start + VALIO_MAX_PRODUCTS), requestedDate));
    }
    return answers;
  }

  return {
    stats,
    async lookup(productIds, requestedDate) {
      const ids = [...new Set(productIds)];
      const key = (id: string) => `${id}|${requestedDate}`;
      const fresh = <T extends { at: number }>(entry: T | undefined, ttl: number) => entry && now() - entry.at < ttl;

      const needPrice = ids.filter((id) => !fresh(prices.get(key(id)), PRICE_TTL_MS));
      const needStock = ids.filter((id) => !fresh(stock.get(key(id)), AVAILABILITY_TTL_MS));
      stats.cacheHits += ids.length * 2 - needPrice.length - needStock.length;

      const [priceAnswers, stockAnswers] = await Promise.all([
        needPrice.length ? inBatches<{ products: ValioPrice[] }>("/api/price", needPrice, requestedDate) : [],
        needStock.length ? inBatches<{ timeNow: string; products: ValioAvailability[] }>("/api/availability", needStock, requestedDate) : [],
      ]);
      const at = now();
      for (const answer of priceAnswers) for (const price of answer.products) prices.set(key(price.productId), { at, value: price });
      for (const answer of stockAnswers) {
        for (const line of answer.products) stock.set(key(line.productId), { at, value: line, timeNow: answer.timeNow });
      }

      const result: ValioAnswer = { timeNow: "", prices: new Map(), availability: new Map() };
      for (const id of ids) {
        const price = prices.get(key(id));
        const available = stock.get(key(id));
        if (price) result.prices.set(id, price.value);
        if (available) {
          result.availability.set(id, available.value);
          if (available.timeNow > result.timeNow) result.timeNow = available.timeNow;
        }
      }
      result.timeNow ||= new Date(at).toISOString();
      return result;
    },
  };
}

/** A recorded answer for one product, as the APIs returned it. */
export interface ValioRecording {
  price: ValioPrice;
  availability: ValioAvailability;
}

/**
 * Replays recorded answers, for tests and for running without a key. Tests
 * can change a product's availability, the way a supplier's stock changes.
 */
export function createRecordedValio(recordings: Record<string, ValioRecording>, timeNow: string) {
  const data = structuredClone(recordings);
  const stats: ValioStats = { calls: 0, productsRequested: 0, cacheHits: 0, failures: 0 };
  let failing = false;
  const client: ValioClient & {
    setAvailability: (id: string, change: Partial<ValioAvailability> | { availableAmount: number }) => void;
    setPrice: (id: string, eurWithoutTax: number) => void;
    failNextCalls: (fail: boolean) => void;
  } = {
    stats,
    async lookup(productIds, requestedDate) {
      stats.calls++;
      stats.productsRequested += productIds.length;
      if (failing) {
        stats.failures++;
        throw new ValioUnavailableError("HTTP 503 from /api/price");
      }
      const answer: ValioAnswer = { timeNow, prices: new Map(), availability: new Map() };
      for (const id of new Set(productIds)) {
        const recording = data[id];
        if (!recording) continue;
        answer.prices.set(id, { ...recording.price, productId: id });
        // The recordings answer for the earliest date, as the live API does.
        void requestedDate;
        answer.availability.set(id, structuredClone(recording.availability));
      }
      return answer;
    },
    setAvailability(id, change) {
      const recording = data[id];
      if (!recording) throw new Error(`No recording for ${id}`);
      if ("availableAmount" in change && typeof change.availableAmount === "number") {
        for (const line of recording.availability.scheduleLines) line.availableAmount = change.availableAmount;
      } else {
        Object.assign(recording.availability, change);
      }
    },
    setPrice(id, eurWithoutTax) {
      const recording = data[id];
      if (!recording?.price.catalogPrice) throw new Error(`No price recording for ${id}`);
      recording.price.catalogPrice.value = eurWithoutTax;
    },
    failNextCalls(fail) {
      failing = fail;
    },
  };
  return client;
}

export type RecordedValio = ReturnType<typeof createRecordedValio>;
