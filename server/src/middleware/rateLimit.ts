import rateLimit from "express-rate-limit";

// Protects paid AI endpoints (embeddings/chat) from being hammered by
// anonymous traffic on the public Cloud Run URL.
export const aiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
