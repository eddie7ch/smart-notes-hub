import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";

// Firebase web config is meant to be public — it identifies the project, it
// doesn't grant access. Real security comes from Firebase Auth issuing signed
// ID tokens that the server verifies (see server/src/middleware/auth.ts).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// "Remember me" toggles whether the session survives closing the browser
// (local storage) or is cleared when the tab/browser closes (session-only).
// The password itself is never persisted anywhere on the client.
export function signIn(email: string, password: string, rememberMe: boolean) {
  return setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence).then(() =>
    signInWithEmailAndPassword(auth, email, password)
  );
}

export function signUp(email: string, password: string) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signOutUser() {
  return signOut(auth);
}

export function resetPassword(email: string) {
  return sendPasswordResetEmail(auth, email);
}

export { onAuthStateChanged };
export type { User };
