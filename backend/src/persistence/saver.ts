import type { AuditEntry } from "../services/audit.js";
import type { Store } from "../store.js";
import type { StateRepository } from "./mariadb.js";
import { serializeStore } from "./snapshot.js";

export interface Persistence {
  /** Saves now if anything changed since the last save. */
  flush(): Promise<void>;
  /** Saves a last time and closes the connection, for a clean shutdown. */
  stop(): Promise<void>;
}

const EPOCH = new Date(0);

/**
 * Saves the store whenever it has changed, checked every interval, so every
 * route and every background job (agent runs, the stock watch) is covered
 * without each having to remember to save. Audit entries are appended to
 * their own table exactly once.
 */
export function startSaving(
  store: Store,
  repository: StateRepository,
  { intervalMs = 1500, onError = (error: unknown) => console.error("Saving state failed:", error instanceof Error ? error.message : error) } = {},
): Persistence {
  // Entries already in the store at start came from the saved snapshot, so they are already in the audit table.
  const savedEntries = new WeakSet<AuditEntry>(store.audit);
  // Compared without the timestamp, so an unchanged store is not saved again.
  let lastSaved = serializeStore(store, EPOCH);
  let running: Promise<void> = Promise.resolve();

  const saveIfChanged = async () => {
    const fingerprint = serializeStore(store, EPOCH);
    if (fingerprint === lastSaved) return;
    const newEntries = store.audit.filter((entry) => !savedEntries.has(entry));
    await repository.save(serializeStore(store), newEntries);
    for (const entry of newEntries) savedEntries.add(entry);
    lastSaved = fingerprint;
  };
  // One save at a time, in order.
  const flush = () => (running = running.then(saveIfChanged, saveIfChanged));

  const timer = setInterval(() => void flush().catch(onError), intervalMs);
  timer.unref();

  return {
    flush,
    async stop() {
      clearInterval(timer);
      await flush().catch(onError);
      await repository.close();
    },
  };
}
