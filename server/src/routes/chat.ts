import { Router } from "express";
import { getAiProvider, type ChatMessage } from "../services/aiProvider.js";
import { semanticSearch } from "./search.js";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const sources = await semanticSearch(req.userId!, message, 5);
    const context = sources
      .map((s, i) => `[${i + 1}] (${s.type}) ${s.title}\n${s.content}`)
      .join("\n\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are a helpful assistant answering questions about the user's personal notes and tasks. " +
          "Use only the provided context. Cite sources by their [n] index. If the context doesn't contain " +
          "the answer, say so plainly.\n\nContext:\n" + (context || "(no matching notes/tasks found)"),
      },
      { role: "user", content: message },
    ];

    const answer = await getAiProvider().chat(messages);
    res.json({ answer, sources: sources.map(({ id, type, title, score }) => ({ id, type, title, score })) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
