import { createApp } from "./app.js";
import { config } from "./config.js";

const port = config.PORT ?? config.BACKEND_PORT;

// Express 5 also calls this callback when listening fails, for example if the port is taken.
createApp({ ...(config.FRONTEND_DIST ? { frontendDist: config.FRONTEND_DIST } : {}) }).listen(port, (error) => {
  if (error) {
    console.error(`Backend could not start on port ${port}: ${error.message}`);
    process.exit(1);
  }

  console.log(`Backend listening on http://localhost:${port}${config.FRONTEND_DIST ? ", serving the frontend" : ""}`);
});
