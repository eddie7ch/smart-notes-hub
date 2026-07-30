import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { itemsRouter } from "./routes/items.js";
import { searchRouter } from "./routes/search.js";
import { chatRouter } from "./routes/chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// Cloud Run intercepts /healthz at the edge, so a custom /health path is used instead.
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/items", itemsRouter);
app.use("/api/search", searchRouter);
app.use("/api/chat", chatRouter);

// Serve the built client so the API and UI ship as a single Cloud Run service.
const clientDist = path.join(__dirname, "..", "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => console.log(`smart-notes-hub server listening on :${port}`));
