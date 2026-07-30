import { Router } from "express";
import { db, type Item } from "../db.js";
import { embedText } from "../services/embeddings.js";

export const itemsRouter = Router();

itemsRouter.get("/", (_req, res) => {
  const rows = db
    .prepare(
      "SELECT id, type, title, content, status, created_at, updated_at FROM items ORDER BY updated_at DESC"
    )
    .all();
  res.json(rows);
});

itemsRouter.post("/", async (req, res) => {
  const { type, title, content, status } = req.body as Partial<Item>;
  if (!type || !title || !content || !["note", "task"].includes(type)) {
    res.status(400).json({ error: "type ('note'|'task'), title, and content are required" });
    return;
  }

  let embedding: string | null = null;
  try {
    embedding = JSON.stringify(await embedText(`${title}\n${content}`));
  } catch (err) {
    // Embedding is best-effort: item is still saved without semantic search support.
    console.error("Embedding failed:", (err as Error).message);
  }

  const result = db
    .prepare(
      "INSERT INTO items (type, title, content, status, embedding) VALUES (?, ?, ?, ?, ?)"
    )
    .run(type, title, content, status ?? "open", embedding);

  res.status(201).json({ id: Number(result.lastInsertRowid), type, title, content, status: status ?? "open" });
});

itemsRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { title, content, status } = req.body as Partial<Item>;

  const existing = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as unknown as
    | Item
    | undefined;
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const nextTitle = title ?? existing.title;
  const nextContent = content ?? existing.content;
  const nextStatus = status ?? existing.status;

  let embedding = existing.embedding;
  if (title || content) {
    try {
      embedding = JSON.stringify(await embedText(`${nextTitle}\n${nextContent}`));
    } catch (err) {
      console.error("Embedding failed:", (err as Error).message);
    }
  }

  db.prepare(
    "UPDATE items SET title = ?, content = ?, status = ?, embedding = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(nextTitle, nextContent, nextStatus, embedding, id);

  res.json({ id, type: existing.type, title: nextTitle, content: nextContent, status: nextStatus });
});

itemsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM items WHERE id = ?").run(id);
  res.status(204).send();
});
