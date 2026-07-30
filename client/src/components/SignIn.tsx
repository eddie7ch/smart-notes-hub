import { useState } from "react";
import { signIn, signUp } from "../firebase.js";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel" style={{ maxWidth: 360, margin: "0 auto" }}>
      <h2>{mode === "signup" ? "Create account" : "Sign in"}</h2>
      <form className="item-form" onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        style={{ background: "none", border: "none", color: "#8ab4f8", cursor: "pointer" }}
      >
        {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Create one"}
      </button>
    </section>
  );
}
