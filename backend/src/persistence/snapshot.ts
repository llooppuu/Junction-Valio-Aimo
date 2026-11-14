import { exportBuyerKey, importBuyerKey, buyerDid } from "../services/mandates.js";
import { exportSigningKey, importSigningKey } from "../services/signing.js";
import type { Store } from "../store.js";

/**
 * The store's purchasing state as one JSON document, and back. Everything a
 * restart would otherwise lose is in it: quotes, orders, the audit history,
 * mandates, earned autonomy, agent runs and conversations, plans, alerts,
 * suggestions, inventory, reservations, and the counters that number them.
 * The signing keys go with it, so offers and mandates signed before a restart
 * still verify after it. Live price and availability are not saved; they are
 * fetched from Valio Aimo again when needed.
 */

export const SNAPSHOT_VERSION = 1;

/** The parts of the store that are saved. Policies, principals, and the catalog come from code and configuration. */
const SAVED_KEYS = [
  "trackRecords",
  "reservations",
  "quotes",
  "nextQuoteNumber",
  "orders",
  "nextOrderNumber",
  "audit",
  "inventory",
  "plans",
  "nextPlanNumber",
  "alerts",
  "nextAlertNumber",
  "suggestions",
  "nextSuggestionNumber",
  "mandates",
  "nextMandateNumber",
] as const satisfies readonly (keyof Store)[];

interface Snapshot {
  version: number;
  savedAt: string;
  keys: { offerSigning: string; buyer: string };
  state: Record<string, unknown>;
}

// Maps become tagged arrays of entries, so nested maps (track records) survive the round trip.
const replacer = (_key: string, value: unknown) => (value instanceof Map ? { __map: [...value.entries()] } : value);
const reviver = (_key: string, value: unknown) =>
  value && typeof value === "object" && "__map" in value && Array.isArray((value as { __map: unknown }).__map)
    ? new Map((value as { __map: [unknown, unknown][] }).__map)
    : value;

export function serializeStore(store: Store, now: Date = new Date()): string {
  const state: Record<string, unknown> = Object.fromEntries(SAVED_KEYS.map((key) => [key, store[key]]));
  // The agent's runs and conversations, without the abort controllers of runs in progress.
  state.agent = {
    runs: store.agent.runs,
    conversations: store.agent.conversations,
    nextRunNumber: store.agent.nextRunNumber,
    nextConversationNumber: store.agent.nextConversationNumber,
  };
  const snapshot: Snapshot = { version: SNAPSHOT_VERSION, savedAt: now.toISOString(), keys: { offerSigning: exportSigningKey(), buyer: exportBuyerKey() }, state };
  return JSON.stringify(snapshot, replacer);
}

/** Restores a saved document into the store. Returns false, changing nothing, for a document from an unknown version. */
export function restoreStore(store: Store, json: string): boolean {
  const snapshot = JSON.parse(json, reviver) as Snapshot;
  if (snapshot.version !== SNAPSHOT_VERSION) return false;
  importSigningKey(snapshot.keys.offerSigning);
  importBuyerKey(snapshot.keys.buyer);
  const target = store as unknown as Record<string, unknown>;
  for (const key of SAVED_KEYS) {
    if (key in snapshot.state) target[key] = snapshot.state[key];
  }
  store.buyerIssuer = buyerDid();

  const agent = snapshot.state.agent as Pick<Store["agent"], "runs" | "conversations" | "nextRunNumber" | "nextConversationNumber"> | undefined;
  if (agent) {
    store.agent.runs = agent.runs;
    store.agent.conversations = agent.conversations;
    store.agent.nextRunNumber = agent.nextRunNumber;
    store.agent.nextConversationNumber = agent.nextConversationNumber;
    // A run cut off by the restart cannot resume: its model call is gone. It is marked failed, and its conversation freed.
    for (const run of store.agent.runs.values()) {
      if (run.status !== "running") continue;
      run.status = "failed";
      run.error = "The server restarted while the agent was working. Send the request again.";
      run.finishedAt = snapshot.savedAt;
    }
    for (const conversation of store.agent.conversations.values()) conversation.running = false;
  }
  return true;
}
