import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Resolves to the repository root from both src/ and dist/.
const envFile = fileURLToPath(new URL("../../.env", import.meta.url));

// Variables already set in the shell take priority over the file.
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const envSchema = z.object({
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Most hosting platforms tell the app which port to listen on in PORT. It wins over BACKEND_PORT.
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  // In production, the built frontend (frontend/dist). When set, the backend serves it and adds
  // the buyer's and wholesaler's demo tokens to browser requests, as the Vite proxy does in development.
  FRONTEND_DIST: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  // The secret in the demo's access link, /login?key=<value>. Required when FRONTEND_DIST is set:
  // only a browser that opened the link acts as the buyer. At least 16 characters.
  DEMO_ACCESS_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.string().min(16, "DEMO_ACCESS_KEY must be at least 16 characters").optional()),
  // Demo credentials. Every value here is synthetic, but change them before exposing the app.
  AGENT_TOKEN: z.string().min(8).default("demo-agent-token"),
  BUYER_TOKEN: z.string().min(8).default("demo-buyer-token"),
  // A second agent, for the school kitchen with strict allergen and nutrition rules.
  SCHOOL_AGENT_TOKEN: z.string().min(8).default("demo-school-agent-token"),
  // The wholesaler's operations team, who see agent activity across every buyer.
  WHOLESALER_TOKEN: z.string().min(8).default("demo-wholesaler-token"),
  // The AI agent's model. Without a key the agent is switched off and everything else still runs.
  // The key is read only here, on the server, and is never sent to a client.
  OPENAI_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.5"),
  OPENAI_REASONING_EFFORT: z.enum(["minimal", "low", "medium", "high"]).default("low"),
  // Valio Aimo's mock price and availability APIs. The key is read only here, on the server.
  // Without it the catalog can still be searched, but nothing can be priced, quoted, or ordered.
  VALIO_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  VALIO_API_URL: z.url().default("https://junction26.valioaimo.fi"),
  // Where the state is saved between restarts, for example mariadb://tta:password@localhost:3306/tta.
  // Without it, quotes, orders, and the audit history live in memory and a restart starts over.
  DATABASE_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  // Voice input in the agent workspace, through Gemini Live. Without a key the microphone button is
  // hidden and typing works as before. The key stays on the server; browsers get single-use tokens.
  GEMINI_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  GEMINI_LIVE_MODEL: z.string().min(1).default("gemini-3.5-transcribe-live"),
});

export const config = envSchema.parse(process.env);
