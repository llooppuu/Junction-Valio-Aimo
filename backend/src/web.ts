import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";

/**
 * Production hosting in one process: the backend serves the built frontend
 * and plays the part the Vite proxy plays in development. The browser app is
 * the buyer's app, so a browser request without a token gets the buyer's demo
 * token, or the wholesaler's under /api/wholesaler. A request that brings its
 * own token, such as an AI agent's, keeps it: the token decides the role.
 */

export interface BrowserTokens {
  buyer: string;
  wholesaler: string;
}

/** Adds the demo token for browser requests that carry none. Mounted before the API routes. */
export function browserTokenMiddleware(tokens: BrowserTokens) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.headers.authorization) {
      const token = req.originalUrl.startsWith("/api/wholesaler") ? tokens.wholesaler : tokens.buyer;
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
