import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateReviewedScreenshots } from "./check-screenshot-publication.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

test("accepts the exact reviewed screenshot bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "screenshot-publication-"));
  writeFileSync(join(root, "invite.png"), "reviewed pixels");

  assert.deepEqual(validateReviewedScreenshots(root, [{ path: "invite.png", sha256: digest("reviewed pixels") }]), []);
});

test("requires publication review again when sensitive screenshot bytes change", () => {
  const root = mkdtempSync(join(tmpdir(), "screenshot-publication-"));
  writeFileSync(join(root, "invite.png"), "unreviewed pixels");

  assert.deepEqual(validateReviewedScreenshots(root, [{ path: "invite.png", sha256: digest("reviewed pixels") }]), [
    "invite.png changed after its bearer-value publication review; inspect it and update the reviewed SHA-256.",
  ]);
});

test("reports a reviewed screenshot that is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "screenshot-publication-"));

  assert.deepEqual(validateReviewedScreenshots(root, [{ path: "missing.png", sha256: digest("missing") }]), [
    "missing.png is missing.",
  ]);
});
