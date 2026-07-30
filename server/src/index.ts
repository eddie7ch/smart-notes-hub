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
// Cloud Run's frontend adds exactly one hop; trusting only that hop (vs `true`,
// which trusts any number of hops) keeps express-rate-limit's client IP lookup safe.
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(generalRateLimiter);

// Cloud Run intercepts /healthz at the edge, so a custom /health path is used instead.
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Route handlers await DB/AI calls without try/catch, so an unhandled rejection
// (e.g. a transient DB outage) would otherwise crash the whole process (exit(1))
// instead of just failing that one request - taking down /health with it.
process.on("unhandledRejection", (err) => {
  logger.error(err, "Unhandled promise rejection");
});

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
