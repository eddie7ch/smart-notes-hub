import { useEffect, useState } from "react";
import { ItemList } from "./components/ItemList.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { SignIn } from "./components/SignIn.js";
import { auth, onAuthStateChanged, signOutUser, type User } from "./firebase.js";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setUser(u);
    setReady(true);
  }), []);

  if (!ready) {
    return (
      <div className="layout">
        <h1>Smart Notes Hub</h1>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="layout">
        <h1>Smart Notes Hub</h1>
        <SignIn />
      </div>
    );
  }

  return (
    <div className="layout">
      <div className="header-row">
        <h1>Smart Notes Hub</h1>
        <div className="user-bar">
          <span>{user.email}</span>
          <button onClick={() => signOutUser()}>Sign out</button>
        </div>
      </div>
      <ItemList />
      <ChatPanel />
    </div>
  );
}
