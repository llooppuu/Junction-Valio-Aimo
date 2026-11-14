import { createPool, type Pool } from "mariadb";
import type { AuditEntry } from "../services/audit.js";

/**
 * Where the store's state is saved between restarts. The MariaDB version
 * keeps the latest snapshot in one row, and every audit entry in an
 * append-only table of its own, which keeps the history across demo resets
 * and can be queried with plain SQL.
 */
export interface StateRepository {
  /** The latest saved snapshot, or undefined when nothing has been saved yet. */
  load(): Promise<string | undefined>;
  /** Saves the snapshot and appends audit entries not saved before. */
  save(snapshot: string, newAuditEntries: readonly AuditEntry[]): Promise<void>;
  close(): Promise<void>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tta_state (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    version INT NOT NULL,
    saved_at DATETIME(3) NOT NULL,
    state LONGTEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS tta_audit (
    seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    entry_id VARCHAR(32) NOT NULL,
    at DATETIME(3) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    actor_role VARCHAR(16) NOT NULL,
    action VARCHAR(64) NOT NULL,
    quote_id VARCHAR(32) NULL,
    order_id VARCHAR(32) NULL,
    summary TEXT NOT NULL,
    entry LONGTEXT NOT NULL,
    KEY tta_audit_at (at),
    KEY tta_audit_quote (quote_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

/** MariaDB's DATETIME takes no time zone, so instants are stored in UTC. */
const sqlTime = (iso: string) => iso.replace("T", " ").replace("Z", "").slice(0, 23);

export async function mariadbRepository(url: string, { attempts = 30, delayMs = 1000 } = {}): Promise<StateRepository> {
  const pool: Pool = createPool({ ...parseUrl(url), connectionLimit: 3, timezone: "Z" });
  // The database may still be starting next to the app, as in docker compose, so the first connection is retried.
  for (let attempt = 1; ; attempt++) {
    try {
      for (const statement of SCHEMA) await pool.query(statement);
      break;
    } catch (error) {
      if (attempt >= attempts) {
        await pool.end().catch(() => undefined);
        throw new Error(`Could not reach MariaDB at ${redact(url)}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    async load() {
      const rows: { state: string }[] = await pool.query("SELECT state FROM tta_state WHERE id = 1");
      return rows[0]?.state;
    },
    async save(snapshot, newAuditEntries) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(
          "INSERT INTO tta_state (id, version, saved_at, state) VALUES (1, ?, ?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version), saved_at = VALUES(saved_at), state = VALUES(state)",
          [JSON.parse(snapshot).version ?? 0, sqlTime(new Date().toISOString()), snapshot],
        );
        if (newAuditEntries.length > 0) {
          await connection.batch(
            "INSERT INTO tta_audit (entry_id, at, actor_id, actor_role, action, quote_id, order_id, summary, entry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            newAuditEntries.map((entry) => [
              entry.id,
              sqlTime(entry.at),
              entry.actor.id,
              entry.actor.role,
              entry.action,
              entry.quoteId ?? null,
              entry.orderId ?? null,
              entry.summary,
              JSON.stringify(entry),
            ]),
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback().catch(() => undefined);
        throw error;
      } finally {
        connection.release();
      }
    },
    close: () => pool.end(),
  };
}

/** mariadb://user:password@host:port/database */
function parseUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "mariadb:" && parsed.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must look like mariadb://user:password@host:3306/database");
  }
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
  };
}

const redact = (url: string) => url.replace(/\/\/([^:@/]+):[^@/]*@/, "//$1:***@");
