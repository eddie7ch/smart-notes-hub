import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/index.js";

describe("GET /health", () => {
  it("returns ok without requiring an API key", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("API key enforcement", () => {
  it("rejects item creation without x-api-key when API_KEY is set", async () => {
    process.env.API_KEY = "test-secret";
    const res = await request(app).post("/api/items").send({
      type: "note",
      title: "t",
      content: "c",
    });
    expect(res.status).toBe(401);
    delete process.env.API_KEY;
  });
});
