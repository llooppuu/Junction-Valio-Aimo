import type { Response } from "express";
import type { z } from "zod";

/** An expected failure with a status code and a message the client can act on. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: object = {},
  ) {
    super(message);
  }
}

/** Sends a 400 response that lists every problem in the request. */
export function sendValidationError(res: Response, error: z.ZodError) {
  res.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    })),
  });
}

export function sendError(res: Response, status: number, error: string, extra: object = {}) {
  res.status(status).json({ error, ...extra });
}

/** The problems in a failed parse, as one readable line for the audit history. */
export function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

/** Parses a request part with a Zod schema, or sends a 400 and returns undefined. */
export function parseOr400<T>(schema: z.ZodType<T>, input: unknown, res: Response): T | undefined {
  const result = schema.safeParse(input);
  if (!result.success) {
    sendValidationError(res, result.error);
    return undefined;
  }
  return result.data;
}
