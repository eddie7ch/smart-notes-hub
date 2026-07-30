import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Provider abstraction lets the chat backend be swapped via AI_CHAT_PROVIDER
// without touching the RAG pipeline (mirrors the dual-backend pattern used
// in the Hey Girl assistant project).
export interface AiProvider {
  chat(messages: ChatMessage[]): Promise<string>;
}

class OpenAiProvider implements AiProvider {
  private client: OpenAI;
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    this.client = new OpenAI({ apiKey });
  }
  async chat(messages: ChatMessage[]): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });
    return res.choices[0].message.content ?? "";
  }
}

class AnthropicProvider implements AiProvider {
  private client: Anthropic;
  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    this.client = new Anthropic({ apiKey });
  }
  async chat(messages: ChatMessage[]): Promise<string> {
    const system = messages.find((m) => m.role === "system")?.content;
    const rest = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    const res = await this.client.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 1024,
      system,
      messages: rest,
    });
    const block = res.content[0];
    return block.type === "text" ? block.text : "";
  }
}

export function getAiProvider(): AiProvider {
  const provider = (process.env.AI_CHAT_PROVIDER ?? "openai").toLowerCase();
  return provider === "anthropic" ? new AnthropicProvider() : new OpenAiProvider();
}
