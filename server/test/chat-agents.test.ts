import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// Keep tests off the real local-dev sqlite file (and off server.test.ts's own copy).
process.env.DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-data-chat.db");

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token === "user-1-token") return { uid: "user-1" };
      throw new Error("invalid token");
    },
  }),
}));

// Deterministic stand-ins for the router/answer/critic agents' LLM calls, so
// the orchestration logic (branching + agentTrace) can be tested without a
// real API key. Each test queues up one mocked reply per agent call, in order.
const chatMock = vi.fn();
vi.mock("../src/services/aiProvider.js", () => ({
  getAiProvider: () => ({ chat: chatMock }),
}));

vi.mock("../src/services/embeddings.js", () => ({
  embedText: vi.fn(async () => new Array(1536).fill(0)),
  cosineSimilarity: () => 1,
}));

const { app } = await import("../src/index.js");

describe("POST /api/chat - agent orchestration", () => {
  it("routes a creation request to the action agent and actually creates the item", async () => {
    chatMock.mockResolvedValueOnce(
      JSON.stringify({ kind: "create_item", type: "task", title: "Buy milk", content: "Buy milk from the store" })
    );

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer user-1-token")
      .send({ message: "remind me to buy milk" });

    expect(res.status).toBe(200);
    expect(res.body.agentTrace.map((s: { agent: string }) => s.agent)).toEqual(["router", "action"]);
    expect(res.body.answer).toMatch(/Created task "Buy milk"/);

    const items = await request(app).get("/api/items").set("Authorization", "Bearer user-1-token");
    expect(items.body.some((i: { title: string }) => i.title === "Buy milk")).toBe(true);
  });

  it("routes a question to the retrieval+answer agent, then runs the critic agent", async () => {
    chatMock
      .mockResolvedValueOnce(JSON.stringify({ kind: "answer_question" })) // router
      .mockResolvedValueOnce("You don't have any notes about vacation plans yet.") // retrieval+answer
      .mockResolvedValueOnce(JSON.stringify({ grounded: false, note: "the sources don't mention vacations" })); // critic

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer user-1-token")
      .send({ message: "what did I write about vacation plans?" });

    expect(res.status).toBe(200);
    expect(res.body.agentTrace.map((s: { agent: string }) => s.agent)).toEqual([
      "router",
      "retrieval+answer",
      "critic",
    ]);
    expect(res.body.answer).toMatch(/\u26a0\ufe0f/);
  });

  it("routes small talk to the chit-chat agent, skipping retrieval and the critic", async () => {
    chatMock
      .mockResolvedValueOnce(JSON.stringify({ kind: "chit_chat" })) // router
      .mockResolvedValueOnce("Hey! Doing well, thanks for asking."); // chit-chat reply

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer user-1-token")
      .send({ message: "hi, how's it going?" });

    expect(res.status).toBe(200);
    expect(res.body.agentTrace.map((s: { agent: string }) => s.agent)).toEqual(["router", "chit-chat"]);
    expect(res.body.answer).toBe("Hey! Doing well, thanks for asking.");
    expect(res.body.answer).not.toMatch(/\u26a0\ufe0f/);
  });

  it("falls back to the question-answering path if the router agent returns invalid JSON", async () => {
    chatMock
      .mockResolvedValueOnce("not valid json at all") // router (malformed)
      .mockResolvedValueOnce("Here's what I found.") // retrieval+answer
      .mockResolvedValueOnce(JSON.stringify({ grounded: true })); // critic

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer user-1-token")
      .send({ message: "hello?" });

    expect(res.status).toBe(200);
    expect(res.body.agentTrace[0]).toEqual({ agent: "router", summary: "intent=answer_question" });
  });
});
