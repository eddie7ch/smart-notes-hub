import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// Keep tests off the real local-dev sqlite file (and off the other test files' copies).
process.env.DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-data-coach.db");

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token === "user-1-token") return { uid: "user-1" };
      if (token === "user-2-token") return { uid: "user-2" };
      throw new Error("invalid token");
    },
  }),
}));

// Deterministic stand-in for the coaching agent's LLM call, so evaluateStep's
// branching (correct/incorrect, last step -> done) can be tested without a
// real API key.
const chatMock = vi.fn();
vi.mock("../src/services/aiProvider.js", () => ({
  getAiProvider: () => ({ chat: chatMock }),
}));

vi.mock("../src/services/embeddings.js", () => ({
  embedText: vi.fn(async () => new Array(1536).fill(0)),
  cosineSimilarity: () => 1,
}));

const { app } = await import("../src/index.js");

const SOP_CONTENT = [
  "1. Verify the customer's identity with two forms of ID.",
  "2. Confirm the account balance before processing any refund.",
  "3. Log the interaction in the CRM with a case number.",
].join("\n");

async function createSop(token = "user-1-token") {
  const res = await request(app)
    .post("/api/items")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "sop", title: "Refund Handling SOP", content: SOP_CONTENT });
  return res.body.id as number;
}

describe("GET /api/coach/:id", () => {
  it("returns the requested step of the caller's own SOP", async () => {
    const sopId = await createSop();

    const res = await request(app)
      .get(`/api/coach/${sopId}?stepIndex=1`)
      .set("Authorization", "Bearer user-1-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sopId,
      title: "Refund Handling SOP",
      stepIndex: 1,
      totalSteps: 3,
      step: "Confirm the account balance before processing any refund.",
    });
  });

  it("404s for another user's SOP", async () => {
    const sopId = await createSop("user-1-token");

    const res = await request(app).get(`/api/coach/${sopId}`).set("Authorization", "Bearer user-2-token");

    expect(res.status).toBe(404);
  });

  it("404s for a non-sop item", async () => {
    const noteRes = await request(app)
      .post("/api/items")
      .set("Authorization", "Bearer user-1-token")
      .send({ type: "note", title: "Just a note", content: "not an SOP" });

    const res = await request(app)
      .get(`/api/coach/${noteRes.body.id}`)
      .set("Authorization", "Bearer user-1-token");

    expect(res.status).toBe(404);
  });

  it("rejects an out-of-range stepIndex", async () => {
    const sopId = await createSop();

    const res = await request(app)
      .get(`/api/coach/${sopId}?stepIndex=99`)
      .set("Authorization", "Bearer user-1-token");

    expect(res.status).toBe(400);
  });
});

describe("POST /api/coach/:id - coaching agent", () => {
  it("advances to the next step when the trainee's answer is correct", async () => {
    const sopId = await createSop();
    chatMock.mockResolvedValueOnce(
      JSON.stringify({ correct: true, feedback: "Great - you checked both forms of ID." })
    );

    const res = await request(app)
      .post(`/api/coach/${sopId}`)
      .set("Authorization", "Bearer user-1-token")
      .send({ stepIndex: 0, answer: "I checked their driver's license and a credit card." });

    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(true);
    expect(res.body.done).toBe(false);
    expect(res.body.stepIndex).toBe(1);
    expect(res.body.nextStep).toBe("Confirm the account balance before processing any refund.");
  });

  it("keeps the trainee on the same step when the answer is incorrect", async () => {
    const sopId = await createSop();
    chatMock.mockResolvedValueOnce(
      JSON.stringify({ correct: false, feedback: "You still need to verify a second form of ID." })
    );

    const res = await request(app)
      .post(`/api/coach/${sopId}`)
      .set("Authorization", "Bearer user-1-token")
      .send({ stepIndex: 0, answer: "I just glanced at their name." });

    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(false);
    expect(res.body.stepIndex).toBe(0);
    expect(res.body.nextStep).toBeNull();
    expect(res.body.feedback).toMatch(/second form of ID/);
  });

  it("marks the session done after the last step is answered correctly", async () => {
    const sopId = await createSop();
    chatMock.mockResolvedValueOnce(JSON.stringify({ correct: true, feedback: "Logged correctly." }));

    const res = await request(app)
      .post(`/api/coach/${sopId}`)
      .set("Authorization", "Bearer user-1-token")
      .send({ stepIndex: 2, answer: "I logged it in the CRM with case number 4471." });

    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    expect(res.body.nextStep).toBeNull();
  });
});
