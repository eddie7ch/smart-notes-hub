import { useEffect, useState } from "react";
import type { Item } from "../api.js";
import { api } from "../api.js";

export function ItemList() {
  const [items, setItems] = useState<Item[]>([]);
  const [type, setType] = useState<"note" | "task">("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = () => api.listItems().then(setItems);

  useEffect(() => {
    refresh();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setLoading(true);
    try {
      await api.createItem({ type, title, content, status: "open" });
      setTitle("");
      setContent("");
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async (item: Item) => {
    const status = item.status === "done" ? "open" : "done";
    await api.updateItem(item.id, { status });
    await refresh();
  };

  const remove = async (id: number) => {
    await api.deleteItem(id);
    await refresh();
  };

  return (
    <section className="panel">
      <h2>Notes &amp; Tasks</h2>
      <form className="item-form" onSubmit={handleAdd}>
        <select value={type} onChange={(e) => setType(e.target.value as "note" | "task")}>
          <option value="note">Note</option>
          <option value="task">Task</option>
        </select>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          placeholder="Content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Add"}
        </button>
      </form>

      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id}>
            <div className="item-tag">
              {item.type}
              {item.type === "task" ? ` \u00b7 ${item.status}` : ""}
            </div>
            <strong>{item.title}</strong>
            <p>{item.content}</p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {item.type === "task" && (
                <button className="secondary" onClick={() => toggleStatus(item)}>
                  Mark {item.status === "done" ? "open" : "done"}
                </button>
              )}
              <button className="secondary" onClick={() => remove(item.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li>No notes or tasks yet — add one above.</li>}
      </ul>
    </section>
  );
}
