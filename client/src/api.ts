import { auth } from "./firebase.js";

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

// Every request carries the signed-in user's Firebase ID token so the server
// can verify identity and scope data to that user (see requireAuth).
async function authHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const api = {
  listItems: async () => fetch("/api/items", { headers: await authHeaders() }).then((r) => json<Item[]>(r)),

  createItem: async (item: Pick<Item, "type" | "title" | "content" | "status">) =>
    fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(item),
    }).then((r) => json<Item>(r)),

  updateItem: async (id: number, item: Partial<Item>) =>
    fetch(`/api/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(item),
    }).then((r) => json<Item>(r)),

  deleteItem: async (id: number) =>
    fetch(`/api/items/${id}`, { method: "DELETE", headers: await authHeaders() }),

  chat: async (message: string) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ message }),
    }).then((r) => json<ChatResponse>(r)),
};
