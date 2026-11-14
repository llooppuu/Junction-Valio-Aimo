import { createApp } from "./app.js";
import { config } from "./config.js";
import { mariadbRepository } from "./persistence/mariadb.js";
import { startSaving, type Persistence } from "./persistence/saver.js";
import { restoreStore } from "./persistence/snapshot.js";
import { createStore } from "./store.js";

const port = config.PORT ?? config.BACKEND_PORT;
const store = createStore();

// With DATABASE_URL, the state survives restarts in MariaDB; without it, it lives in memory as before.
let persistence: Persistence | undefined;
if (config.DATABASE_URL) {
  const repository = await mariadbRepository(config.DATABASE_URL);
  const saved = await repository.load();
  if (saved) {
    console.log(restoreStore(store, saved) ? "Restored the saved state from MariaDB." : "The saved state is from another version and was not restored.");
  }
  persistence = startSaving(store, repository);
}

// Express 5 also calls this callback when listening fails, for example if the port is taken.
const server = createApp({ store, ...(config.FRONTEND_DIST ? { frontendDist: config.FRONTEND_DIST } : {}) }).listen(port, (error) => {
  if (error) {
    console.error(`Backend could not start on port ${port}: ${error.message}`);
    process.exit(1);
  }

  const notes = [config.FRONTEND_DIST ? "serving the frontend" : "", persistence ? "saving state to MariaDB" : ""].filter(Boolean);
  console.log(`Backend listening on http://localhost:${port}${notes.length ? `, ${notes.join(", ")}` : ""}`);
});

// A platform stops the container with SIGTERM: save the last changes before exiting.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    server.close();
    void (persistence?.stop() ?? Promise.resolve()).finally(() => process.exit(0));
  });
}
