// Unit tests for the server-side org-gate drift cross-check (#91). The client
// stamps its build-time VITE_GOOGLE_HD on each scan request; the server compares
// it to its runtime ALLOWED_HD via hdDriftWarning() and logs a warning on
// mismatch. This pins that it warns EXACTLY when the two have diverged — normalized
// the same way the auth gates normalize (trim + case-fold) so cosmetic differences
// don't false-alarm — and stays silent when they agree (including both empty, the
// OSS "cloud mode, no domain lock" config).

import { test } from "node:test";
import assert from "node:assert/strict";
import { hdDriftWarning } from "../netlify/functions/parse-schedule.mjs";

test("agreement ⇒ null (no warning)", () => {
  assert.equal(hdDriftWarning("example.com", "example.com"), null);
});

test("both empty ⇒ null (OSS cloud-no-lock parity)", () => {
  for (const v of ["", "   ", undefined, null]) {
    assert.equal(hdDriftWarning(v as string, ""), null);
    assert.equal(hdDriftWarning("", v as string), null);
  }
});

test("the named failure: client empty while server set ⇒ warns", () => {
  const w = hdDriftWarning("", "example.com");
  assert.ok(w, "must warn when the client gate would silently no-op");
  assert.match(w!, /example\.com/);
});

test("reverse drift: client set while server empty ⇒ warns", () => {
  assert.ok(hdDriftWarning("example.com", ""));
});

test("two different domains ⇒ warns", () => {
  assert.ok(hdDriftWarning("elsewhere.com", "example.com"));
});

test("case and whitespace differences do NOT warn (folded like the gates)", () => {
  assert.equal(hdDriftWarning("  Example.COM ", "example.com"), null);
  assert.equal(hdDriftWarning("example.com", "EXAMPLE.COM"), null);
});

// Multi-domain lists: compared as SETS — same members in any order agree, a real
// membership difference warns.
test("identical multi-domain lists in different order ⇒ null (set compare)", () => {
  assert.equal(
    hdDriftWarning("example.com,example.org", "example.org, example.com"),
    null,
  );
});

test("subset/superset lists ⇒ warns (a domain gated on one side only)", () => {
  const w = hdDriftWarning("example.com", "example.com,example.org");
  assert.ok(w, "one gate covers a domain the other doesn't");
  assert.match(w!, /example\.org/);
});

test("duplicate and blank entries are normalized before comparing", () => {
  assert.equal(
    hdDriftWarning("example.com,,example.com", " example.com "),
    null,
  );
});
