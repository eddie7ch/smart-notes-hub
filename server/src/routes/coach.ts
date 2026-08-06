import { Router } from "express";
import { itemRepository } from "../db.js";
import { parseSopSteps, evaluateStep } from "../services/coaching.js";

export const coachRouter = Router();

// GET /api/coach/:id?stepIndex=0 - start (or resume) a coaching session.
// Purely deterministic (no LLM call): just returns the requested step of the
// caller's own SOP item.
coachRouter.get("/:id", async (req, res) => {
  const sop = await itemRepository.get(Number(req.params.id), req.userId!);
  if (!sop || sop.type !== "sop") {
    res.status(404).json({ error: "SOP not found" });
    return;
  }

  const steps = parseSopSteps(sop.content);
  const stepIndex = Number(req.query.stepIndex ?? 0);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) {
    res.status(400).json({ error: `stepIndex must be an integer between 0 and ${steps.length - 1}` });
    return;
  }

  res.json({ sopId: sop.id, title: sop.title, stepIndex, totalSteps: steps.length, step: steps[stepIndex] });
});

// POST /api/coach/:id { stepIndex, answer } - the coaching agent: evaluate the
// trainee's stated action for one step against the digitized SOP, and return
// the next step (or completion) if it was correct.
coachRouter.post("/:id", async (req, res) => {
  const { stepIndex, answer } = req.body as { stepIndex?: number; answer?: string };
  if (stepIndex === undefined || !answer) {
    res.status(400).json({ error: "stepIndex and answer are required" });
    return;
  }

  const sop = await itemRepository.get(Number(req.params.id), req.userId!);
  if (!sop || sop.type !== "sop") {
    res.status(404).json({ error: "SOP not found" });
    return;
  }

  const steps = parseSopSteps(sop.content);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= steps.length) {
    res.status(400).json({ error: `stepIndex must be an integer between 0 and ${steps.length - 1}` });
    return;
  }

  try {
    const result = await evaluateStep(sop.title, steps, stepIndex, answer);
    res.json({ sopId: sop.id, title: sop.title, totalSteps: steps.length, ...result });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
