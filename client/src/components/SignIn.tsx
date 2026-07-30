import { useState } from "react";
import { resetPassword, signIn, signUp } from "../firebase.js";

const REMEMBERED_EMAIL_KEY = "smart-notes-hub:rememberedEmail";

export function SignIn() {
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem(REMEMBERED_EMAIL_KEY) !== null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        await signUp(email, password);
      } else {
        await signIn(email, password, rememberMe);
      }
      // Only the email is remembered, purely for convenience - the password
      // itself is never written to storage.
      if (rememberMe) {
        localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
      } else {
        localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    setInfo(null);
    if (!email) {
      setError("Enter your email above first");
      return;
    }
    try {
      await resetPassword(email);
      setInfo("Password reset email sent — check your inbox");
    } catch (err) {
      setError((err as Error).message);
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
        <div style={{ position: "relative" }}>
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
            style={{ width: "100%", boxSizing: "border-box", paddingRight: 36 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "#8ab4f8",
              padding: 0,
            }}
          >
            {showPassword ? "🙈" : "👁️"}
          </button>
        </div>
        {mode === "signup" && (
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={6}
            required
          />
        )}
        {mode === "signin" && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem" }}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Remember me
          </label>
        )}
        {mode === "signin" && (
          <button
            type="button"
            onClick={handleForgotPassword}
            style={{ background: "none", border: "none", color: "#8ab4f8", cursor: "pointer", textAlign: "left", padding: 0 }}
          >
            Forgot password?
          </button>
        )}
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
        {info && <p style={{ color: "#4ade80" }}>{info}</p>}
        <button type="submit" disabled={loading}>
          {mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "signup" ? "signin" : "signup");
          setError(null);
          setInfo(null);
          setConfirmPassword("");
        }}
        style={{ background: "none", border: "none", color: "#8ab4f8", cursor: "pointer" }}
      >
        {mode === "signup" ? "Already have an account? Sign in" : "Need an account? Create one"}
      </button>
    </section>
  );
}
