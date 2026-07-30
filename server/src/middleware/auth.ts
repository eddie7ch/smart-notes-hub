import type { NextFunction, Request, Response } from "express";

// Gates write/AI endpoints with a shared API key so the public Cloud Run URL
// can't be used by strangers to burn paid OpenAI/Anthropic quota.
export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const configuredKey = process.env.API_KEY;
  if (!configuredKey) {
    if (process.env.NODE_ENV === "production") {
      res.status(500).json({ error: "Server misconfigured: API_KEY is not set" });
      return;
    }
    // No key configured in local dev: fail open for convenience.
    next();
    return;
  }

  const provided = req.header("x-api-key");
  if (provided !== configuredKey) {
    res.status(401).json({ error: "Missing or invalid x-api-key header" });
    return;
  }
  next();
}
