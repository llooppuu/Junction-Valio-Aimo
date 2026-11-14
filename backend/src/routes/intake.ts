import express, { Router } from "express";
import { z } from "zod";
import { requireRole } from "../auth.js";
import { ApiError, parseOr400 } from "../http.js";
import { NOT_A_LIST, type ListReader } from "../services/listReader.js";
import type { Store } from "../store.js";

/** The largest image accepted, after the browser has scaled it down: about 4 MB of image data. */
const MAX_IMAGE_CHARS = 5_600_000;

export const readListSchema = z.strictObject({
  /** The photo or screenshot as a data URL: PNG, JPEG, WebP, or GIF. */
  image: z
    .string()
    .max(MAX_IMAGE_CHARS, "The image is too large. Send one under 4 MB.")
    .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, "Send the image as a base64 data URL: PNG, JPEG, WebP, or GIF."),
  /** The language to write the request in. English by default. */
  language: z.enum(["en", "fi"]).optional(),
});

const NOT_CONFIGURED = "Reading lists from photos needs GEMINI_API_KEY or OPENAI_API_KEY. Type the request instead.";

/** Turns a photo of a purchasing list into a request for the buyer to check and send. */
export function intakeRouter(store: Store, reader: ListReader | null) {
  const router = Router();

  router.get("/", requireRole(store, "buyer"), (_req, res) => {
    res.json({ available: reader !== null, model: reader?.model ?? null });
  });

  // Images need a larger body than the rest of the API, so this route parses its own.
  router.post("/list", requireRole(store, "buyer"), express.json({ limit: "6mb" }), async (req, res) => {
    const input = parseOr400(readListSchema, req.body, res);
    if (!input) return;
    if (!reader) throw new ApiError(503, NOT_CONFIGURED);
    let text: string;
    try {
      text = await reader.read({ dataUrl: input.image }, input.language ?? "en");
    } catch (error) {
      console.error("Reading a list failed:", error instanceof Error ? error.message : error);
      throw new ApiError(502, "The list could not be read this time. Try again, or type the request.");
    }
    if (!text || text.includes(NOT_A_LIST)) {
      throw new ApiError(422, "This does not look like a purchasing list. Try a clearer photo, or type the request.", { notAList: true });
    }
    res.json({ text: text.slice(0, 2000) });
  });

  return router;
}
