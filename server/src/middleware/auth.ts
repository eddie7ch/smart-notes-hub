import type { NextFunction, Request, Response } from "express";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

if (!getApps().length) {
  // On Cloud Run this picks up the project + credentials from the metadata
  // server automatically; locally it uses `gcloud auth application-default login`.
  initializeApp();
}

// Verifies a Firebase Auth ID token so each user only ever sees their own
// notes/tasks — real per-user identity, not just a shared bot-deterrence key.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const decoded = await getAuth().verifyIdToken(header.slice("Bearer ".length));
    req.userId = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
