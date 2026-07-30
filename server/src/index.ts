import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { itemsRouter } from "./routes/items.js";
import { searchRouter } from "./routes/search.js";
import { chatRouter } from "./routes/chat.js";
import { requireAuth } from "./middleware/auth.js";
import { aiRateLimiter, generalRateLimiter } from "./middleware/rateLimit.js";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
// Cloud Run always sits behind a proxy; without this express-rate-limit
// keys every client on the same internal IP instead of the real caller.
app.set("trust proxy", true);
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(generalRateLimiter);

// Cloud Run intercepts /healthz at the edge, so a custom /health path is used instead.
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/items", requireAuth, itemsRouter);
app.use("/api/search", requireAuth, aiRateLimiter, searchRouter);
app.use("/api/chat", requireAuth, aiRateLimiter, chatRouter);

// Serve the built client so the API and UI ship as a single Cloud Run service.
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, () => logger.info(`smart-notes-hub server listening on :${port}`));
}
