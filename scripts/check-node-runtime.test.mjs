import assert from "node:assert/strict";
import test from "node:test";
import { assertSupportedNodeVersion, supportsNodeVersion } from "../apps/backend/start/node_version.ts";

test("runtime boundaries reject unsupported versions before application startup", () => {
  for (const version of ["23.9.0", "24.18.9", "25.0.0", "26.8.9", "27.0.0", "invalid"]) {
    assert.equal(supportsNodeVersion(version), false, version);
    assert.throws(() => assertSupportedNodeVersion(version), /CapacityLens requires Node/);
  }
  for (const version of ["24.19.0", "24.21.0", "26.9.0", "26.10.0"]) {
    assert.equal(supportsNodeVersion(version), true, version);
    assert.doesNotThrow(() => assertSupportedNodeVersion(version));
  }
});
