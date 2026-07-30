import { useState } from "react";
import { api } from "../api.js";
import type { ChatSource } from "../api.js";

interface Turn {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
}

export function ChatPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    setMessage("");
    setTurns((t) => [...t, { role: "user", content: text }]);
    setLoading(true);
    try {
      const { answer, sources } = await api.chat(text);
      setTurns((t) => [...t, { role: "assistant", content: answer, sources }]);
    } catch (err) {
      setTurns((t) => [
        ...t,
        { role: "assistant", content: `Error: ${(err as Error).message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <h2>Ask your notes (RAG chat)</h2>
      <div className="chat-log">
        {turns.map((turn, i) => (
          <div key={i} className={`chat-bubble ${turn.role}`}>
            {turn.content}
            {turn.sources && turn.sources.length > 0 && (
              <div className="sources">
                Sources: {turn.sources.map((s) => `[${s.title}]`).join(" ")}
              </div>
            )}
          </div>
        ))}
        {turns.length === 0 && <p>Ask a question about your notes or tasks.</p>}
      </div>
      <form className="chat-input" onSubmit={send}>
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. What do I still need to finish this week?"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Thinking..." : "Send"}
        </button>
      </form>
    </section>
  );
}
