import { Router } from "express";
import {
  routeIntent,
  createItemFromIntent,
  answerFromNotes,
  checkGroundedness,
  replyChitChat,
  type AgentStep,
} from "../services/agents.js";

export const chatRouter = Router();

// /api/chat is a small multi-agent pipeline rather than a single prompt->response
// call:
//   1. Router agent    - classifies the message as a create-item request, a
//                         question to answer from the user's notes/tasks, or
//                         casual chit-chat.
//   2a. Action agent   - (create-item path) executes the create as a real
//                         tool call against the repository.
//   2b. Chit-chat agent - (chit-chat path) replies conversationally, with no
//                         retrieval and no groundedness check - there's
//                         nothing to ground small talk in.
//   2c. Retrieval+answer agent (RAG) - (question path) retrieves relevant
//                         notes/tasks and answers using only that context.
//   3. Critic agent    - (question path only) an independent LLM call that
//                         checks the answer is actually grounded in the
//                         retrieved sources, flagging it if not.
// `agentTrace` in the response shows which agents ran and what they decided.
chatRouter.post("/", async (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const trace: AgentStep[] = [];

  try {
    const intent = await routeIntent(message);
    trace.push({ agent: "router", summary: `intent=${intent.kind}` });

    if (intent.kind === "create_item") {
      const item = await createItemFromIntent(req.userId!, intent);
      trace.push({ agent: "action", summary: `created ${item.type} #${item.id}: "${item.title}"` });
      res.json({ answer: `Created ${item.type} "${item.title}".`, sources: [], agentTrace: trace });
      return;
    }

    if (intent.kind === "chit_chat") {
      const reply = await replyChitChat(message);
      trace.push({ agent: "chit-chat", summary: "replied conversationally, no retrieval" });
      res.json({ answer: reply, sources: [], agentTrace: trace });
      return;
    }

    const { answer, sources } = await answerFromNotes(req.userId!, message);
    trace.push({ agent: "retrieval+answer", summary: `used ${sources.length} source(s)` });

    const { grounded, note } = await checkGroundedness(answer, sources);
    trace.push({ agent: "critic", summary: grounded ? "grounded" : `not grounded: ${note}` });

    const finalAnswer = grounded
      ? answer
      : `${answer}\n\n\u26a0\ufe0f ${note ?? "This answer may not be fully supported by your notes."}`;

    res.json({
      answer: finalAnswer,
      sources: sources.map(({ id, type, title, score }) => ({ id, type, title, score })),
      agentTrace: trace,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
