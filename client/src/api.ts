export interface Item {
  id: number;
  type: "note" | "task";
  title: string;
  content: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface ChatSource {
  id: number;
  type: string;
  title: string;
  score: number;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Shared secret baked in at build time (see infra notes in README) — deters
// opportunistic bots hitting the public URL, not a substitute for real
// per-user auth (out of scope for this single-user demo).
const authHeaders: HeadersInit = import.meta.env.VITE_API_KEY
  ? { "x-api-key": import.meta.env.VITE_API_KEY }
  : {};

export const api = {
  listItems: () => fetch("/api/items", { headers: authHeaders }).then((r) => json<Item[]>(r)),

  createItem: (item: Pick<Item, "type" | "title" | "content" | "status">) =>
    fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(item),
    }).then((r) => json<Item>(r)),

  updateItem: (id: number, item: Partial<Item>) =>
    fetch(`/api/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(item),
    }).then((r) => json<Item>(r)),

  deleteItem: (id: number) => fetch(`/api/items/${id}`, { method: "DELETE", headers: authHeaders }),

  chat: (message: string) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ message }),
    }).then((r) => json<ChatResponse>(r)),
};
