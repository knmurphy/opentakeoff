// Unit tests for the sessionStorage session-restore validator (#148). Real
// GIS sign-in can't be exercised here (needs a live Google account); this
// covers the pure decision — readPersistedSession() — that everything else
// (persistSession/hydrateSession) is built on. See authDomain.test.ts for the
// same pure-function-extraction pattern.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readPersistedSession, persistSession, hydrateSession, getUser, isSignedIn, signOut } from "../src/lib/google/auth.js";

// Map-backed sessionStorage stub, matching identity.test.ts's stubStore()
// pattern. clientId() reads import.meta.env, which is undefined outside Vite
// (plain node:test), so it always resolves to "" here — stubbed blobs below
// use clientId: "" to match, the same way this module's own hydrateSession()
// would see it in this test environment.
function stubSessionStorage() {
  const store = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

const NOW = 1_700_000_000_000;
const CLIENT_ID = "abc123.apps.googleusercontent.com";
const USER = { email: "kevin@example.com", name: "Kevin", hd: "example.com" };

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
  assert.equal(readPersistedSession(blob({ user: "kevin@example.com" }), { now: NOW, clientId: CLIENT_ID }), null);
  assert.equal(readPersistedSession(blob({ user: ["not", "an", "object"] }), { now: NOW, clientId: CLIENT_ID }), null);
});

test("user object with no usable email ⇒ null (AccountChip/AuthChip read user.email directly)", () => {
  assert.equal(readPersistedSession(blob({ user: {} }), { now: NOW, clientId: CLIENT_ID }), null);
  assert.equal(readPersistedSession(blob({ user: { name: "Kevin" } }), { now: NOW, clientId: CLIENT_ID }), null);
  assert.equal(readPersistedSession(blob({ user: { email: "" } }), { now: NOW, clientId: CLIENT_ID }), null);
  assert.equal(readPersistedSession(blob({ user: { email: 42 } }), { now: NOW, clientId: CLIENT_ID }), null);
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

// The tests above cover readPersistedSession() (the pure decision). These
// cover the actual sessionStorage glue around it — hydrateSession(),
// persistSession(), and signOut()'s clear — against a stubbed sessionStorage,
// so a regression in the glue itself (wrong module state read, swapped
// arguments, wrong key) would be caught, not just a bug in the pure validator.

test("hydrateSession() restores getUser()/isSignedIn() from a valid stubbed blob", () => {
  const store = stubSessionStorage();
  (globalThis as any).window = {}; // signOut()'s window.google?.… reference needs this to exist
  try {
    const restoredUser = { email: "kevin@example.com", name: "Kevin" };
    store.set("opentakeoff_gauth", JSON.stringify({
      clientId: "", // clientId() resolves to "" outside Vite — see stubSessionStorage() comment
      accessToken: "ya29.fake-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      user: restoredUser,
    }));

    hydrateSession();

    assert.equal(isSignedIn(), true);
    assert.deepEqual(getUser(), restoredUser);
  } finally {
    signOut(); // reset the module's shared token/user state for later tests
    delete (globalThis as any).sessionStorage;
    delete (globalThis as any).window;
  }
});

test("hydrateSession() leaves getUser()/isSignedIn() signed-out when the stubbed blob is expired", () => {
  const store = stubSessionStorage();
  (globalThis as any).window = {};
  try {
    store.set("opentakeoff_gauth", JSON.stringify({
      clientId: "",
      accessToken: "ya29.fake-token",
      expiresAt: Date.now() - 1,
      user: { email: "kevin@example.com" },
    }));

    hydrateSession();

    assert.equal(isSignedIn(), false);
    assert.equal(getUser(), null);
  } finally {
    signOut();
    delete (globalThis as any).sessionStorage;
    delete (globalThis as any).window;
  }
});

test("persistSession() writes the current session, then signOut() clears it", () => {
  const store = stubSessionStorage();
  (globalThis as any).window = {};
  try {
    const restoredUser = { email: "kevin@example.com" };
    store.set("opentakeoff_gauth", JSON.stringify({
      clientId: "",
      accessToken: "ya29.fake-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
      user: restoredUser,
    }));
    hydrateSession(); // populate module state from the stub, exercising the read path

    persistSession(); // re-persist the now-populated state, exercising the write path
    const written = JSON.parse(store.get("opentakeoff_gauth")!);
    assert.equal(written.accessToken, "ya29.fake-token");
    assert.deepEqual(written.user, restoredUser);

    signOut();
    assert.equal(store.has("opentakeoff_gauth"), false); // signOut()'s persistSession() cleared it
    assert.equal(isSignedIn(), false);
  } finally {
    delete (globalThis as any).sessionStorage;
    delete (globalThis as any).window;
  }
});
