// Account chip — the two-deck toolbar's home for "who am I" (issue #61).
// Absorbs AuthChip's behavior: renders NOTHING when the build isn't configured
// for Google, a "Sign in" button (with surfaced failure reason) when signed
// out, and an initials disc + menu (email, sync note, Sign out) when signed in.
// The gallery header still uses the plain AuthChip; this chip is the toolbar's.
import React, { useState } from "react";
import { useGoogleAuth } from "../lib/google/AuthContext.jsx";
import ToolMenu from "./ToolMenu.jsx";

const initialsOf = (user) => {
  const src = String(user?.name || user?.email || "").trim();
  const parts = src.split(/[\s._@-]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export default function AccountChip({ note, onOpenChange }) {
  const { user, ready, configured, signIn, signOut } = useGoogleAuth();
  const [err, setErr] = useState("");
  if (!configured) return null;   // cloud mode off → no UI at all

  if (!user) {
    // Surface sign-in failures instead of swallowing them: log for debugging and
    // show the reason in the button tooltip so a broken sign-in isn't silent.
    const onSignIn = () => {
      setErr("");
      signIn().catch((e) => {
        const msg = String(e?.message || e);
        console.error("Google sign-in failed:", msg);
        setErr(msg);
      });
    };
    return (
      <button type="button" disabled={!ready} onClick={onSignIn}
        title={err ? `Sign-in failed: ${err}` : "Sign in with your team Google account to open cloud projects"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px",
          border: "1px solid var(--ink-faint)", background: "transparent", color: "var(--ink)",
          cursor: ready ? "pointer" : "default", fontSize: 12.5, lineHeight: 1, opacity: ready ? 1 : 0.5,
          ...(err ? { borderColor: "var(--c-danger)", color: "var(--c-danger)" } : {}),
        }}>
        {err ? "Sign in failed — retry" : "Sign in"}
      </button>
    );
  }

  return (
    <ToolMenu
      title={`Account — ${user.email}`}
      onOpenChange={onOpenChange}
      faceStyle={{ padding: "4px 8px 4px 4px" }}
      menuStyle={{ minWidth: 224 }}
      face={
        <span aria-label="Account" style={{
          width: 20, height: 20, background: "var(--cobalt)", color: "var(--paper-bright)",
          fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 700,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>{initialsOf(user)}</span>
      }
      items={[
        { section: "Signed in" },
        { note: <>{user.email}{note ? <><br />{note}</> : null}</> },
        "divider",
        { id: "signout", label: "Sign out", danger: true, title: "Sign out", onSelect: () => signOut() },
      ]}
    />
  );
}
