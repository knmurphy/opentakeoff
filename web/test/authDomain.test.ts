// Unit tests for the client-side org-domain gate on the PAID schedule scan
// reader. domainAllows() is the pure decision behind isAllowedDomain(); it MUST
// mirror the server's ALLOWED_HD check in netlify/functions/parse-schedule.mjs
// (hd || email-domain, case-folded; empty allowed = any account). These tests
// pin that contract so the client and server can't silently diverge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { domainAllows } from "../src/lib/google/auth.js";

const orgUser = { email: "kevin@345flooring.com", hd: "345flooring.com" };
const gmailUser = { email: "someone@gmail.com" };            // personal account, no hd
const orgNoHd = { email: "kevin@345flooring.com" };          // org email, hd claim absent
const aliasHd = { email: "kevin@alias.example", hd: "345flooring.com" }; // hd wins over email

test("empty allowed domain ⇒ any account (server parity with empty ALLOWED_HD)", () => {
  for (const allowed of ["", "   ", undefined, null]) {
    assert.equal(domainAllows(allowed as string, orgUser), true);
    assert.equal(domainAllows(allowed as string, gmailUser), true);
    assert.equal(domainAllows(allowed as string, null), true);   // even signed-out, when unlocked
  }
});

test("domain set + no signed-in user ⇒ false (fails closed)", () => {
  assert.equal(domainAllows("345flooring.com", null), false);
  assert.equal(domainAllows("345flooring.com", undefined), false);
});

test("matching org account ⇒ true", () => {
  assert.equal(domainAllows("345flooring.com", orgUser), true);
});

test("non-org (gmail) account ⇒ false", () => {
  assert.equal(domainAllows("345flooring.com", gmailUser), false);
});

test("org email with no hd claim falls back to the email domain ⇒ true", () => {
  assert.equal(domainAllows("345flooring.com", orgNoHd), true);
});

test("hd claim takes precedence over the email domain (mirrors the server)", () => {
  // hd matches, email domain differs ⇒ allowed
  assert.equal(domainAllows("345flooring.com", aliasHd), true);
  // hd differs, email domain matches ⇒ denied (server prefers hd too)
  assert.equal(domainAllows("345flooring.com", { email: "x@345flooring.com", hd: "elsewhere.com" }), false);
});

test("comparison is case-insensitive and trims the configured domain", () => {
  assert.equal(domainAllows("  345Flooring.COM ", { email: "K@345FLOORING.com" }), true);
  assert.equal(domainAllows("345flooring.com", { email: "k@345Flooring.Com", hd: "345FLOORING.COM" }), true);
});

test("user with neither hd nor a usable email domain ⇒ false", () => {
  assert.equal(domainAllows("345flooring.com", { email: "" }), false);
  assert.equal(domainAllows("345flooring.com", {}), false);
});
