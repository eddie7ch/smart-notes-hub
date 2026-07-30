import { Router } from "express";
import { itemRepository, type Item } from "../db.js";
import { embedText } from "../services/embeddings.js";

export const itemsRouter = Router();

itemsRouter.get("/", async (req, res) => {
  res.json(await itemRepository.list(req.userId!));
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

  const item = await itemRepository.create(req.userId!, type, title, content, status ?? "open", embedding);
  res.status(201).json({ id: item.id, type: item.type, title: item.title, content: item.content, status: item.status });
});

itemsRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { title, content, status } = req.body as Partial<Item>;

  const existing = await itemRepository.get(id, req.userId!);
  if (!existing) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  let embedding: string | null | undefined;
  if (title || content) {
    try {
      embedding = JSON.stringify(
        await embedText(`${title ?? existing.title}\n${content ?? existing.content}`)
      );
    } catch (err) {
      console.error("Embedding failed:", (err as Error).message);
    }
  }

  const updated = await itemRepository.update(id, req.userId!, { title, content, status, embedding });
  res.json({ id, type: updated!.type, title: updated!.title, content: updated!.content, status: updated!.status });
});

itemsRouter.delete("/:id", async (req, res) => {
  await itemRepository.remove(Number(req.params.id), req.userId!);
  res.status(204).send();
});
