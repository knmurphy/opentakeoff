// web/test/slotKey.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotKey } from "../src/lib/tilePatterns/slotKey.ts";

test("floored modulo keys negatives", () => {
  assert.equal(slotKey({ i: -1, j: 0 }, { w: 2, h: 2 }), "1_0");
  assert.equal(slotKey({ i: 3, j: -2, p: 2 }, { w: 2, h: 2 }), "1_0_2");
});
