// The token-AUDIENCE check in the gated schedule reader
// (netlify/functions/parse-schedule.mjs), which decides whether a bearer token
// minted for some OTHER Google OAuth app is allowed to spend this deployment's
// Gemini key.
//
// It arrived from upstream (their #167) calling Google's tokeninfo endpoint
// with POST and a form-encoded body. tokeninfo is GET-only, so the request
// always failed: `tiRes.ok` was false, `aud` fell back to "", and the mismatch
// branch returned 401 for everyone. Turning the check ON turned the endpoint
// OFF — and because the failure only appears once GOOGLE_CLIENT_ID is set, the
// only deployments that worked were the ones silently skipping the check. This
// fork documented that variable as recommended in the same change that found
// the bug, which is exactly the combination that would have shipped an outage.
//
// Two rules pinned here, and the second is the one worth having:
//   1. the request is a GET with the token as a query parameter;
//   2. "we could not check" (network error, non-2xx, unparseable body) is 502,
//      NOT the 401 that tells a user to sign in again — advice that does not
//      help and is not true when Google simply did not answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGoogleUser } from "../netlify/functions/parse-schedule.mjs";

const PROFILE = { email: "e@example.com", email_verified: true, hd: "example.com" };

/** Stub fetch: first call is the userinfo profile, second is tokeninfo. */
function withFetch(tokeninfo: () => unknown, run: () => Promise<unknown>) {
  const real = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  let n = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (n++ === 0) return { ok: true, json: async () => PROFILE } as unknown as Response;
    return tokeninfo() as Response;
  }) as typeof fetch;
  return run().then((r) => ({ r, calls }), (e) => { globalThis.fetch = real; throw e; })
    .then((out) => { globalThis.fetch = real; return out; });
}

const withAud = async (tokeninfo: () => unknown) => {
  const prev = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "client-abc.apps.googleusercontent.com";
  try { return await withFetch(tokeninfo, () => verifyGoogleUser("Bearer tok-123")); }
  finally { if (prev === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = prev; }
};

test("tokeninfo is fetched as a GET with the token in the query string", async () => {
  const { r, calls } = await withAud(() => ({ ok: true, json: async () => ({ aud: "client-abc.apps.googleusercontent.com" }) }));
  assert.equal((r as { ok: boolean }).ok, true, "a token minted for THIS app passes");
  const ti = calls[1];
  assert.match(ti.url, /tokeninfo\?access_token=tok-123$/, "the token rides the query string");
  assert.ok(!ti.init || !ti.init.method || ti.init.method === "GET", `tokeninfo is GET, got ${ti.init?.method}`);
  assert.ok(!ti.init?.body, "…with no body — a POST here fails and every caller gets 401");
});

test("a token minted for ANOTHER app is refused, and only that is a 401", async () => {
  const { r } = await withAud(() => ({ ok: true, json: async () => ({ aud: "someone-else.apps.googleusercontent.com" }) }));
  assert.deepEqual(r, { ok: false, status: 401, msg: "Token audience mismatch — sign in again." });
});

test("an unanswered check is 502, never the 401 that blames the user", async () => {
  for (const [name, ti] of [
    ["non-2xx from tokeninfo", () => ({ ok: false, status: 500, json: async () => ({}) })],
    ["unparseable body", () => ({ ok: true, json: async () => { throw new Error("not json"); } })],
    ["network error", () => { throw new Error("ECONNRESET"); }],
  ] as const) {
    const { r } = await withAud(ti as () => unknown);
    assert.deepEqual(r, { ok: false, status: 502, msg: "Couldn't verify your sign-in." },
      `${name} must read as "we could not check", not "your sign-in is wrong"`);
  }
});

test("with GOOGLE_CLIENT_ID unset the check is skipped, and tokeninfo is not called at all", async () => {
  const prev = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  try {
    const { r, calls } = await withFetch(() => { throw new Error("tokeninfo must not be called"); },
      () => verifyGoogleUser("Bearer tok-123"));
    assert.equal((r as { ok: boolean }).ok, true);
    assert.equal(calls.length, 1, "userinfo only");
  } finally { if (prev !== undefined) process.env.GOOGLE_CLIENT_ID = prev; }
});
