import { createApp } from "./app.js";
import { config } from "./config.js";

const port = config.BACKEND_PORT;

// Express 5 also calls this callback when listening fails, for example if the port is taken.
createApp().listen(port, (error) => {
  if (error) {
    console.error(`Backend could not start on port ${port}: ${error.message}`);
    process.exit(1);
  }

  console.log(`Backend listening on http://localhost:${port}`);
});
