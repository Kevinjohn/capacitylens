import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runDetachedPackageProbe } from "./check-node26.mjs";

test("runtime probe scopes build settings, packages through the supported entry and smokes detached links", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-runtime-probe-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repositoryRoot = join(directory, "source");
  const deployDir = join(directory, "detached");
  const calls = [];
  runDetachedPackageProbe({
    repositoryRoot,
    deployDir,
    runCommand(label, command, args, environment) {
      calls.push({ label, command, args, environment });
      if (label === "production package") {
        assert.deepEqual(args, ["run", "package:managed-release"]);
        mkdirSync(join(repositoryRoot, "production/backend/node_modules"), { recursive: true });
        writeFileSync(join(repositoryRoot, "production/backend/ace.js"), "compiled-runtime");
        symlinkSync("../ace.js", join(repositoryRoot, "production/backend/node_modules/runtime"));
      }
      if (label === "deployed runtime smoke") {
        const backend = join(deployDir, "production/backend");
        assert.deepEqual(args, ["run", "smoke:packaged-server", backend]);
        assert.equal(readFileSync(join(backend, "node_modules/runtime"), "utf8"), "compiled-runtime");
        rmSync(repositoryRoot, { recursive: true });
        assert.equal(readFileSync(join(backend, "node_modules/runtime"), "utf8"), "compiled-runtime");
      }
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].environment.NODE_ENV, "production");
  for (const key of [
    "APP_KEY",
    "APP_URL",
    "HOST",
    "PORT",
    "LOG_LEVEL",
    "SESSION_DRIVER",
    "CAPACITYLENS_SECRET",
    "CAPACITYLENS_PUBLIC_URL",
  ])
    assert.ok(calls[0].environment[key], key);
  assert.equal(calls[1].environment, undefined);
  assert.equal(calls[2].environment, undefined);
});
