import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

/**
 * Production hosting in one process: the backend serves the built frontend
 * and plays the part the Vite proxy plays in development.
 *
 * The browser app acts as the buyer (or as the wholesaler under
 * /api/wholesaler), but only for a browser that opened the demo's access link,
 * /login?key=<DEMO_ACCESS_KEY>. That link sets a signed, HTTP-only session
 * cookie, and only requests carrying it get the demo identities. A request
 * with neither the cookie nor a token of its own is refused like any other
 * unauthenticated call, so leaving out an agent token never grants buyer rights.
 */

export interface DemoAccess {
  /** The secret in the access link. Changing it signs every browser out. */
  key: string;
  buyerToken: string;
  wholesalerToken: string;
}

export const SESSION_COOKIE = "tta_demo_session";
/** How long a browser stays signed in after opening the link. The link itself can be used any number of times. */
const SESSION_DAYS = 30;

/** The cookie's value: derived from the key, so it cannot be forged without it and stops working when the key changes. */
export function sessionValue(key: string): string {
  return createHmac("sha256", key).update("trusted-trade-agents demo session v1").digest("base64url");
}

function equalSecrets(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Whether the request comes from a browser that opened the access link. */
export function hasDemoSession(req: Request, access: DemoAccess): boolean {
  const value = readCookie(req, SESSION_COOKIE);
  return value !== undefined && equalSecrets(value, sessionValue(access.key));
}

/**
 * GET /login?key=… — the magic link. A correct key sets the session cookie and
 * opens the app; a wrong one opens the app's sign-in screen with a notice.
 * Registered outside /api because a person opens it in the browser.
 */
export function demoLoginHandler(access: DemoAccess) {
  return (req: Request, res: Response) => {
    const key = typeof req.query.key === "string" ? req.query.key : "";
    if (!key || !equalSecrets(key, access.key)) {
      res.redirect(302, "/?access=denied");
      return;
    }
    const secure = req.secure || req.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
    res.cookie(SESSION_COOKIE, sessionValue(access.key), {
      httpOnly: true,
      // Lax keeps the cookie off cross-site POSTs, so another site cannot act as the buyer.
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    });
    res.redirect(302, "/");
  };
}

/** Adds the demo identity to requests from a signed-in browser that carry no token. Mounted before the API routes. */
export function browserTokenMiddleware(access: DemoAccess) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.headers.authorization && hasDemoSession(req, access)) {
      const token = req.originalUrl.startsWith("/api/wholesaler") ? access.wholesalerToken : access.buyerToken;
      req.headers.authorization = `Bearer ${token}`;
    }
    next();
  };
}

/** Serves the built frontend, with index.html for every other non-API path so client-side links work. */
export function serveFrontend(app: Express, distDir: string) {
  const root = resolve(distDir);
  const index = join(root, "index.html");
  if (!existsSync(index)) {
    throw new Error(`FRONTEND_DIST is set to ${root}, but there is no index.html there. Run "npm run build" first.`);
  }
  // Built assets have hashed names, so they can be cached for a long time; index.html never is.
  app.use(express.static(root, { index: false, maxAge: "7d", immutable: true }));
  app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(index);
  });
}
