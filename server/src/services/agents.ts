import { getAiProvider, type ChatMessage } from "./aiProvider.js";
import { semanticSearch } from "../routes/search.js";
import { itemRepository, type Item, type ScoredItem } from "../db.js";
import { embedText } from "./embeddings.js";

// A small multi-agent pipeline for /api/chat: a router agent decides what the
// user wants, a second agent either executes that action (create an item) or
// answers from retrieved notes (RAG), and - on the question-answering path
// only - a third, independent critic agent checks the answer is actually
// grounded in the retrieved sources before it's returned.

export interface AgentStep {
  agent: string;
  summary: string;
}

// Agents ask the LLM to reply with strict JSON. Models occasionally wrap the
// object in markdown fences or add a stray sentence, so this pulls out the
// first {...} block instead of trusting JSON.parse on the raw string.
function extractJson<T>(raw: string): T {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Agent did not return JSON: ${raw}`);
  return JSON.parse(match[0]) as T;
}

// --- 1. Router agent -------------------------------------------------------
// Classifies intent before any retrieval happens: is the user asking a
// question that should be answered from their existing notes/tasks, or
// asking to create a new one ("remind me to...", "add a task...")?
export type Intent =
  | { kind: "create_item"; type: "note" | "task"; title: string; content: string }
  | { kind: "answer_question" };

export async function routeIntent(message: string): Promise<Intent> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a routing agent for a notes/tasks assistant. Decide whether the user's message is " +
        "(a) asking a question that should be answered using their existing notes/tasks, or " +
        "(b) asking to create a new note or task.\n\n" +
        "Reply with ONLY a JSON object, no other text:\n" +
        '- For (a): {"kind":"answer_question"}\n' +
        '- For (b): {"kind":"create_item","type":"note"|"task","title":"...","content":"..."}',
    },
    { role: "user", content: message },
  ];

  const raw = await getAiProvider().chat(messages);
  try {
    return extractJson<Intent>(raw);
  } catch {
    // If the router agent misbehaves, fail safe into the question-answering path.
    return { kind: "answer_question" };
  }
}

// --- 2a. Action agent --------------------------------------------------
// Executes the "create_item" intent as a real tool call against the
// repository - the agent's decision has a side effect, not just a suggestion.
export async function createItemFromIntent(
  userId: string,
  intent: Extract<Intent, { kind: "create_item" }>
): Promise<Item> {
  let embedding: string | null = null;
  try {
    embedding = JSON.stringify(await embedText(`${intent.title}\n${intent.content}`));
  } catch (err) {
    console.error("Embedding failed:", (err as Error).message);
  }
  return itemRepository.create(userId, intent.type, intent.title, intent.content, "open", embedding);
}

// --- 2b. Retrieval + answer agent (RAG) -------------------------------------
export async function answerFromNotes(
  userId: string,
  message: string
): Promise<{ answer: string; sources: ScoredItem[] }> {
  const sources = await semanticSearch(userId, message, 5);
  const context = sources.map((s, i) => `[${i + 1}] (${s.type}) ${s.title}\n${s.content}`).join("\n\n");

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
  return { answer, sources };
}

// --- 3. Critic agent (groundedness check) -----------------------------------
// A second, independent LLM call that checks whether the answer actually
// relied on the retrieved sources rather than the model's own unverified
// knowledge - catches hallucination the first agent can't self-detect.
export async function checkGroundedness(
  answer: string,
  sources: ScoredItem[]
): Promise<{ grounded: boolean; note?: string }> {
  if (sources.length === 0) {
    return { grounded: false, note: "No matching notes/tasks were found to ground this answer." };
  }

  const context = sources.map((s, i) => `[${i + 1}] ${s.title}: ${s.content}`).join("\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a fact-checking agent. Given source notes and a proposed answer, decide if the answer's " +
        "claims are actually supported by the sources. Reply with ONLY JSON: " +
        '{"grounded": true|false, "note": "short explanation if not grounded"}',
    },
    { role: "user", content: `Sources:\n${context}\n\nProposed answer:\n${answer}` },
  ];

  try {
    const raw = await getAiProvider().chat(messages);
    return extractJson<{ grounded: boolean; note?: string }>(raw);
  } catch {
    // If the critic itself fails, don't block the response - just skip the check.
    return { grounded: true };
  }
}
