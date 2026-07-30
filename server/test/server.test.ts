import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// Keep tests off the real local-dev sqlite file.
process.env.DB_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "test-data.db");

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

const { app } = await import("../src/index.js");

describe("GET /health", () => {
  it("returns ok without requiring auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("auth enforcement", () => {
  it("rejects item access without a bearer token", async () => {
    const res = await request(app).get("/api/items");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const res = await request(app).get("/api/items").set("Authorization", "Bearer garbage");
    expect(res.status).toBe(401);
  });
});

describe("per-user data isolation", () => {
  it("only returns items created by the same user", async () => {
    await request(app)
      .post("/api/items")
      .set("Authorization", "Bearer user-1-token")
      .send({ type: "note", title: "user 1 note", content: "secret" });

    const user1Items = await request(app).get("/api/items").set("Authorization", "Bearer user-1-token");
    const user2Items = await request(app).get("/api/items").set("Authorization", "Bearer user-2-token");

    expect(user1Items.body.length).toBeGreaterThan(0);
    expect(user2Items.body).toEqual([]);
  });
});

describe("GET /api/items pagination", () => {
  it("respects a custom limit", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/items")
        .set("Authorization", "Bearer user-1-token")
        .send({ type: "note", title: `paged note ${i}`, content: "x" });
    }

    const res = await request(app)
      .get("/api/items?limit=2")
      .set("Authorization", "Bearer user-1-token");

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it("rejects an out-of-range limit", async () => {
    const res = await request(app)
      .get("/api/items?limit=0")
      .set("Authorization", "Bearer user-1-token");

    expect(res.status).toBe(400);
  });

  it("rejects a negative offset", async () => {
    const res = await request(app)
      .get("/api/items?offset=-1")
      .set("Authorization", "Bearer user-1-token");

    expect(res.status).toBe(400);
  });
});
