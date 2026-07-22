// Version arithmetic — the gate every plugin passes through. The major.minor
// comparison is redone here by hand because an off-by-one strands or wrongly
// admits every community plugin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVersion, formatVersion, satisfies } from "../src/lib/plugins/version.ts";

test("parseVersion: valid major.minor → integer parts", () => {
  assert.deepEqual(parseVersion("1.0"), { major: 1, minor: 0 });
  assert.deepEqual(parseVersion("2.13"), { major: 2, minor: 13 });
});

test("parseVersion: minor 10 does NOT collapse to minor 1 (no float parsing)", () => {
  assert.deepEqual(parseVersion("1.10"), { major: 1, minor: 10 });
  assert.notDeepEqual(parseVersion("1.10"), parseVersion("1.1"));
});

test("parseVersion: malformed → null", () => {
  for (const bad of ["1", "1.2.3", "v1.0", "1.x", "", "1.", ".1", 1.0, null, undefined]) {
    assert.equal(parseVersion(bad), null, `expected null for ${String(bad)}`);
  }
});

test("formatVersion round-trips", () => {
  assert.equal(formatVersion({ major: 1, minor: 10 }), "1.10");
});

test("satisfies: same major, host minor >= req minor → renderable", () => {
  // The AC's worked examples: req 1.1 …
  assert.equal(satisfies({ major: 1, minor: 2 }, { major: 1, minor: 1 }), true, "1.1 on host 1.2 renders");
  assert.equal(satisfies({ major: 1, minor: 0 }, { major: 1, minor: 1 }), false, "1.1 on host 1.0 skips");
  assert.equal(satisfies({ major: 2, minor: 0 }, { major: 1, minor: 1 }), false, "1.1 on host 2.0 skips (breaking major)");
});

test("satisfies: exact match renders", () => {
  assert.equal(satisfies({ major: 1, minor: 1 }, { major: 1, minor: 1 }), true);
});

test("satisfies: a plugin pinned to an OLDER major is not run on a newer major host", () => {
  assert.equal(satisfies({ major: 2, minor: 5 }, { major: 1, minor: 0 }), false);
});
