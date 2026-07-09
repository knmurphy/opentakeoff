// Toolbar sign-in chip for the optional Google cloud mode.
//
// Renders NOTHING when the build isn't configured for Google — so the anonymous,
// local-only app looks exactly as it always did. When configured it shows a
// "Sign in" button, or the signed-in user's email with a sign-out affordance.
// All the trust lives in the Internal OAuth app + Drive sharing (see
// lib/google/auth.js); this is just the surface.
import React from "react";
import { useGoogleAuth } from "../lib/google/AuthContext.jsx";

export default function AuthChip() {
  const { user, ready, configured, signIn, signOut } = useGoogleAuth();
  if (!configured) return null;   // cloud mode off → no UI at all

  const base = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px",
    border: "1px solid var(--ink-faint)", background: "transparent",
    color: "var(--ink)", cursor: "pointer", fontSize: 12.5, lineHeight: 1,
  };

  if (!user) {
    return (
      <button type="button" disabled={!ready} onClick={() => { signIn().catch(() => {}); }}
        title="Sign in with your team Google account to open cloud projects"
        style={{ ...base, opacity: ready ? 1 : 0.5, cursor: ready ? "pointer" : "default" }}>
        Sign in
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span title={user.email} style={{ fontSize: 12, color: "var(--ink-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {user.email}
      </span>
      <button type="button" onClick={() => signOut()} title="Sign out"
        style={{ ...base, padding: "5px 8px", color: "var(--ink-muted)" }}>
        Sign out
      </button>
    </span>
  );
}
