// Unit tests for the client-side org-domain gate on the PAID schedule scan
// reader. domainAllows() is the pure decision behind isAllowedDomain(); it MUST
// mirror the server's ALLOWED_HD check in netlify/functions/parse-schedule.mjs
// (hd || email-domain, case-folded; empty allowed = any account). These tests
// pin that contract so the client and server can't silently diverge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { domainAllows } from "../src/lib/google/auth.js";

const orgUser = { email: "kevin@example.com", hd: "example.com" };
const gmailUser = { email: "someone@gmail.com" };            // personal account, no hd
const orgNoHd = { email: "kevin@example.com" };          // org email, hd claim absent
const aliasHd = { email: "kevin@alias.example", hd: "example.com" }; // hd wins over email

test("empty allowed domain ⇒ any account (server parity with empty ALLOWED_HD)", () => {
  for (const allowed of ["", "   ", undefined, null]) {
    assert.equal(domainAllows(allowed as string, orgUser), true);
    assert.equal(domainAllows(allowed as string, gmailUser), true);
    assert.equal(domainAllows(allowed as string, null), true);   // even signed-out, when unlocked
  }
});

test("domain set + no signed-in user ⇒ false (fails closed)", () => {
  assert.equal(domainAllows("example.com", null), false);
  assert.equal(domainAllows("example.com", undefined), false);
});

test("matching org account ⇒ true", () => {
  assert.equal(domainAllows("example.com", orgUser), true);
});

test("non-org (gmail) account ⇒ false", () => {
  assert.equal(domainAllows("example.com", gmailUser), false);
});

test("org email with no hd claim falls back to the email domain ⇒ true", () => {
  assert.equal(domainAllows("example.com", orgNoHd), true);
});

test("hd claim takes precedence over the email domain (mirrors the server)", () => {
  // hd matches, email domain differs ⇒ allowed
  assert.equal(domainAllows("example.com", aliasHd), true);
  // hd differs, email domain matches ⇒ denied (server prefers hd too)
  assert.equal(domainAllows("example.com", { email: "x@example.com", hd: "elsewhere.com" }), false);
});

test("comparison is case-insensitive and trims the configured domain", () => {
  assert.equal(domainAllows("  Example.COM ", { email: "K@EXAMPLE.com" }), true);
  assert.equal(domainAllows("example.com", { email: "k@Example.Com", hd: "EXAMPLE.COM" }), true);
});

test("user with neither hd nor a usable email domain ⇒ false", () => {
  assert.equal(domainAllows("example.com", { email: "" }), false);
  assert.equal(domainAllows("example.com", {}), false);
});

// Multi-domain org: one Workspace spanning several domains lists them all,
// comma-separated. An account is in if its domain matches ANY entry.
const multi = "example.com,example.org";

test("comma-separated allow-list ⇒ any listed domain is in, others out", () => {
  assert.equal(domainAllows(multi, { email: "kevin@example.com", hd: "example.com" }), true);
  assert.equal(domainAllows(multi, { email: "sam@example.org", hd: "example.org" }), true);
  assert.equal(domainAllows(multi, { email: "x@gmail.com" }), false);
});

test("list parsing tolerates whitespace, blanks, case, and trailing commas", () => {
  assert.equal(domainAllows("  Example.COM , , Example.ORG ,", { email: "k@example.org" }), true);
  assert.equal(domainAllows("example.com,,,", { email: "k@example.com" }), true);
  // a list of only blanks/commas normalizes to empty ⇒ any account (server parity)
  assert.equal(domainAllows(" , , ", { email: "anyone@gmail.com" }), true);
});

test("multi-domain list + no signed-in user ⇒ false (fails closed)", () => {
  assert.equal(domainAllows(multi, null), false);
});
