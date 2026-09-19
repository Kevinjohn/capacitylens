import assert from "node:assert/strict";
import test from "node:test";
import { assertEntryBundleWithinBudget, ENTRY_GZIP_LIMIT_BYTES, ENTRY_RAW_LIMIT_BYTES } from "./bundle-budget.mjs";

test("accepts an entry at both bundle boundaries", () => {
  assert.doesNotThrow(() => assertEntryBundleWithinBudget(ENTRY_RAW_LIMIT_BYTES, ENTRY_GZIP_LIMIT_BYTES));
});

test("rejects an entry above the raw boundary", () => {
  assert.throws(
    () => assertEntryBundleWithinBudget(ENTRY_RAW_LIMIT_BYTES + 1, ENTRY_GZIP_LIMIT_BYTES),
    /Bundle budget exceeded/,
  );
});

test("rejects an entry above the gzip boundary", () => {
  assert.throws(
    () => assertEntryBundleWithinBudget(ENTRY_RAW_LIMIT_BYTES, ENTRY_GZIP_LIMIT_BYTES + 1),
    /Bundle budget exceeded/,
  );
});
