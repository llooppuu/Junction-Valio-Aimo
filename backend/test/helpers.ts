import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createApp, type AppOptions } from "../src/app.js";
import type { CatalogEntry } from "../src/data/catalog.js";
import { createStore, type StoreOptions } from "../src/store.js";
import { createRecordedValio, type RecordedValio, type ValioRecording } from "../src/services/valio.js";

/**
 * A slice of Valio Aimo's real catalog and the APIs' recorded answers for it,
 * from scripts/record-fixture.ts. Tests replay them at the recording time, so
 * they never call the APIs and cut-off times compare the same way on every run.
 */
const FIXTURE_CATALOG = JSON.parse(readFileSync(new URL("./fixtures/catalog.json", import.meta.url), "utf8")) as CatalogEntry[];
const FIXTURE_VALIO = JSON.parse(readFileSync(new URL("./fixtures/valio.json", import.meta.url), "utf8")) as {
  recordedAt: string;
  timeNow: string;
  requestedDate: string;
  recordings: Record<string, ValioRecording>;
};

/** When the fixture was recorded. Tests run at this time. */
export const FIXTURE_TIME = new Date(FIXTURE_VALIO.recordedAt);
/** The Monday the fixture's availability is for. */
export const DELIVERY_DATE = FIXTURE_VALIO.requestedDate;

/** A fresh replaying client, which tests can change: a product's stock, its price, or an outage. */
export function recordedValio(): RecordedValio {
  return createRecordedValio(FIXTURE_VALIO.recordings, FIXTURE_VALIO.timeNow);
}

/** A copy of the fixture catalog that a test may change, such as a supplier's product text. */
export function fixtureCatalog(): CatalogEntry[] {
  return structuredClone(FIXTURE_CATALOG);
}

/** A store on the fixture: the catalog slice, replayed answers, and a fixed clock. */
export function testStore(options: StoreOptions = {}) {
  // Each rule is tested on its own, so agents act within their limits unless a test asks for earned autonomy.
  return createStore({ catalog: FIXTURE_CATALOG, valio: recordedValio(), clock: () => new Date(FIXTURE_TIME), autonomy: "limits", semanticIndex: null, embedder: null, ...options });
}

/** The default demo tokens from backend/src/config.ts. */
export const AGENT = "demo-agent-token";
export const BUYER = "demo-buyer-token";

export interface TestResponse {
  status: number;
  // Tests assert on the shape, so the body is deliberately loosely typed.
  body: any;
}

export interface RequestOptions {
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

export interface TestServer {
  baseUrl: string;
  request: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  close: () => Promise<void>;
}

/**
 * Starts the app on a free port. Each call gets its own server and state.
 * The AI agent is off unless a test passes a model, so tests never call OpenAI.
 */
/** The access link's key in tests that serve the frontend. */
export const TEST_ACCESS_KEY = "test-access-key-0123456789";

export async function startTestServer(options: AppOptions = {}): Promise<TestServer> {
  const server = createApp({ agentModel: null, voiceTokens: null, demoAccessKey: TEST_ACCESS_KEY, ...options, store: options.store ?? testStore() }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    async request(method, path, { body, token, headers = {} } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    },
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
