import { ItemList } from "./components/ItemList.js";
import { ChatPanel } from "./components/ChatPanel.js";

export default function App() {
  return (
    <div className="layout">
      <h1>Smart Notes Hub</h1>
      <ItemList />
      <ChatPanel />
    </div>
  );
}
