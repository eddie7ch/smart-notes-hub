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

export const api = {
  listItems: () => fetch("/api/items").then((r) => json<Item[]>(r)),

  createItem: (item: Pick<Item, "type" | "title" | "content" | "status">) =>
    fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    }).then((r) => json<Item>(r)),

  updateItem: (id: number, item: Partial<Item>) =>
    fetch(`/api/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    }).then((r) => json<Item>(r)),

  deleteItem: (id: number) => fetch(`/api/items/${id}`, { method: "DELETE" }),

  chat: (message: string) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }).then((r) => json<ChatResponse>(r)),
};
