import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth.js";
import { ApiError, parseOr400 } from "../http.js";
import type { VoiceTokens } from "../services/voice.js";
import type { Store } from "../store.js";

export const voiceTokenSchema = z.strictObject({
  /** The language the buyer speaks, which the transcription expects. English by default. */
  language: z.enum(["en", "fi"]).optional(),
});

const NOT_CONFIGURED = "Voice input is not configured. Set GEMINI_API_KEY in .env and restart the backend. Typing works without it.";

/** Lets the buyer speak a request instead of typing it. The transcript is never sent anywhere until the buyer presses Send. */
export function voiceRouter(store: Store, tokens: VoiceTokens | null) {
  const router = Router();
  const buyerOnly = requireRole(store, "buyer");

  router.get("/", buyerOnly, (_req, res) => {
    res.json({ available: tokens !== null, model: tokens?.model ?? null });
  });

  router.post("/token", buyerOnly, async (req, res) => {
    const input = parseOr400(voiceTokenSchema, req.body ?? {}, res);
    if (!input) return;
    if (!tokens) throw new ApiError(503, NOT_CONFIGURED);
    try {
      res.status(201).json({ session: await tokens.create(input.language ?? "en") });
    } catch (error) {
      console.error("Gemini Live token request failed:", error instanceof Error ? error.message : error);
      throw new ApiError(502, "Gemini did not issue a voice session. Try again, or type the request.");
    }
  });

  return router;
}
