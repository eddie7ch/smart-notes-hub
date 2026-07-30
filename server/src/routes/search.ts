import { Router } from "express";
import { itemRepository, type ScoredItem } from "../db.js";
import { embedText } from "../services/embeddings.js";

export const searchRouter = Router();

// Nearest-neighbor search itself lives in the repository: pgvector in Postgres,
// a JS cosine-similarity fallback for local sqlite dev.
export async function semanticSearch(userId: string, query: string, k = 5): Promise<ScoredItem[]> {
  const queryEmbedding = await embedText(query);
  return itemRepository.semanticSearch(userId, queryEmbedding, k);
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
