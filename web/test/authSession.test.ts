// Unit tests for the sessionStorage session-restore validator (#148). Real
// GIS sign-in can't be exercised here (needs a live Google account); this
// covers the pure decision — readPersistedSession() — that everything else
// (persistSession/hydrateSession) is built on. See authDomain.test.ts for the
// same pure-function-extraction pattern.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readPersistedSession } from "../src/lib/google/auth.js";

const NOW = 1_700_000_000_000;
const CLIENT_ID = "abc123.apps.googleusercontent.com";
const USER = { email: "kevin@345flooring.com", name: "Kevin", hd: "345flooring.com" };

function blob(overrides = {}) {
  return {
    clientId: CLIENT_ID,
    accessToken: "ya29.fake-token",
    expiresAt: NOW + 60 * 60 * 1000, // 1h out
    user: USER,
    ...overrides,
  };
}

test("valid, unexpired blob for this build restores token + user", () => {
  const restored = readPersistedSession(blob(), { now: NOW, clientId: CLIENT_ID });
  assert.deepEqual(restored, {
    token: { accessToken: "ya29.fake-token", expiresAt: NOW + 60 * 60 * 1000 },
    user: USER,
  });
});

test("expired (or within the skew window of expiry) ⇒ null", () => {
  assert.equal(readPersistedSession(blob({ expiresAt: NOW - 1 }), { now: NOW, clientId: CLIENT_ID }), null);
  // 30s out is inside the 60s EXPIRY_SKEW_MS window — treated as not usable
  assert.equal(readPersistedSession(blob({ expiresAt: NOW + 30_000 }), { now: NOW, clientId: CLIENT_ID }), null);
});

test("clientId mismatch (deploy rotated VITE_GOOGLE_CLIENT_ID) ⇒ null", () => {
  assert.equal(readPersistedSession(blob(), { now: NOW, clientId: "different-client-id" }), null);
});

test("missing or empty accessToken ⇒ null", () => {
  assert.equal(readPersistedSession(blob({ accessToken: "" }), { now: NOW, clientId: CLIENT_ID }), null);
  assert.equal(readPersistedSession(blob({ accessToken: undefined }), { now: NOW, clientId: CLIENT_ID }), null);
});

test("missing user, or user not an object ⇒ null", () => {
  assert.equal(readPersistedSession(blob({ user: undefined }), { now: NOW, clientId: CLIENT_ID }), null);
  assert.equal(readPersistedSession(blob({ user: "kevin@345flooring.com" }), { now: NOW, clientId: CLIENT_ID }), null);
});

test("malformed raw payloads collapse to null", () => {
  for (const raw of [null, undefined, "not-an-object", 42, ["array"]]) {
    assert.equal(readPersistedSession(raw as any, { now: NOW, clientId: CLIENT_ID }), null);
  }
  // expiresAt of the wrong type
  assert.equal(
    readPersistedSession(blob({ expiresAt: "soon" }), { now: NOW, clientId: CLIENT_ID }),
    null,
  );
});
