import { Router } from "express";
import { itemRepository } from "../db.js";
import { embedText, cosineSimilarity } from "../services/embeddings.js";

export const searchRouter = Router();

interface ScoredItem {
  id: number;
  type: string;
  title: string;
  content: string;
  score: number;
}

export async function semanticSearch(userId: string, query: string, k = 5): Promise<ScoredItem[]> {
  const queryEmbedding = await embedText(query);
  const rows = await itemRepository.listWithEmbeddings(userId);

  return rows
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding as string)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

searchRouter.post("/", async (req, res) => {
  const { query, k } = req.body as { query?: string; k?: number };
  if (!query) {
    res.status(400).json({ error: "query is required" });
    return;
  }
  try {
    res.json(await semanticSearch(req.userId!, query, k ?? 5));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
