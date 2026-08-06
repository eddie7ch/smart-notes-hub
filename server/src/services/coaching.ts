import { getAiProvider, type ChatMessage } from "./aiProvider.js";

// "Expert Digitization" (lightweight version): an SOP item's `content` is a
// numbered list of steps, written once by an expert/author. This parses that
// plain-text procedure into an ordered array the coaching agent can check a
// trainee's progress against.
export function parseSopSteps(content: string): string[] {
  const numbered = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+[.)]\s*/.test(line))
    .map((line) => line.replace(/^\d+[.)]\s*/, ""));
  if (numbered.length > 0) return numbered;
  // Not numbered - fall back to one step per non-empty line.
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface StepEvaluation {
  correct: boolean;
  feedback: string;
  stepIndex: number;
  nextStep: string | null;
  done: boolean;
}

// "Autonomous Coaching" agent: a senior-instructor persona that checks a
// trainee's stated action against one specific step of a digitized SOP, and
// decides whether they can move on - real-time, 1:1 guidance grounded in the
// expert-authored procedure rather than the model's own general knowledge.
export async function evaluateStep(
  sopTitle: string,
  steps: string[],
  stepIndex: number,
  userAnswer: string
): Promise<StepEvaluation> {
  const expectedStep = steps[stepIndex];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `You are an autonomous coaching agent guiding a trainee through the standard operating ` +
        `procedure "${sopTitle}", step ${stepIndex + 1} of ${steps.length}.\n` +
        `Expected step: "${expectedStep}"\n\n` +
        "Compare the trainee's stated action to the expected step. Reply with ONLY JSON, no other text:\n" +
        '{"correct": true|false, "feedback": "short, encouraging, instructor-style feedback"}',
    },
    { role: "user", content: userAnswer },
  ];

  let correct = false;
  let feedback = "Couldn't evaluate that step automatically - please try rephrasing your answer.";
  try {
    const raw = await getAiProvider().chat(messages);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as { correct: boolean; feedback: string };
      correct = parsed.correct;
      feedback = parsed.feedback;
    }
  } catch (err) {
    feedback = `Coaching agent error (${(err as Error).message}). Marking this step for manual review.`;
  }

  const done = correct && stepIndex === steps.length - 1;
  const nextIndex = correct ? stepIndex + 1 : stepIndex;
  const nextStep = correct && !done ? steps[nextIndex] : null;

  return { correct, feedback, stepIndex: nextIndex, nextStep, done };
}
