import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareContainerRuntime } from "./prepare-container-runtime.mjs";

test("container assembly preserves compiled runtime and build policy while repairing package self links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-container-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const deployment = join(root, "deployment");
  const backend = join(root, "runtime/backend");
  await mkdir(join(source, "apps/backend/build/bin"), { recursive: true });
  await mkdir(join(source, "apps/backend/build/tests"), { recursive: true });
  await mkdir(join(deployment, "node_modules/@capacitylens"), { recursive: true });
  await writeFile(join(source, "pnpm-workspace.yaml"), "allowBuilds:\n  better-sqlite3: true\n  esbuild: false\n");
  await writeFile(join(source, "apps/backend/build/bin/server.js"), "export {};\n");
  await writeFile(join(source, "apps/backend/build/bin/test.js"), "export {};\n");
  await writeFile(join(source, "apps/backend/build/bin/server.js.map"), "{}\n");
  await symlink("/not-a-runtime", join(deployment, "node_modules/@capacitylens/backend"));
  await prepareContainerRuntime(source, deployment, backend);
  assert.equal(await readFile(join(backend, "bin/server.js"), "utf8"), "export {};\n");
  assert.equal(await readlink(join(backend, "node_modules/@capacitylens/backend")), "../..");
  for (const path of ["tests", "bin/test.js", "bin/server.js.map"])
    await assert.rejects(readFile(join(backend, path)), { code: "ENOENT" });
  assert.match(await readFile(join(backend, "pnpm-workspace.yaml"), "utf8"), /better-sqlite3: true/);
  await assert.rejects(readFile(join(backend, "app/source.ts")), { code: "ENOENT" });
});

test("Compose upgrades before API startup and preserves the private persistent deployment boundary", async () => {
  const { default: YAML } = await import("yaml");
  const compose = YAML.parse(await readFile(new URL("../docker-compose.yml", import.meta.url), "utf8"));
  assert.equal(compose.name, "capacitylens");
  assert.deepEqual(compose.services.upgrade.tmpfs, ["/tmp:size=32m,mode=1777"]);
  assert.deepEqual(compose.services.upgrade.command, ["node", "ace.js", "app:upgrade"]);
  assert.equal(compose.services.api.depends_on.upgrade.condition, "service_completed_successfully");
  assert.deepEqual(compose.services.upgrade.environment, compose.services.api.environment);
  assert.deepEqual(compose.services.api.volumes, ["capacitylens-db:/data", "capacitylens-backups:/backups"]);
  assert.equal(compose.services.api.environment.SESSION_DRIVER, "database");
  assert.equal(compose.services.api.environment.CAPACITYLENS_MODE, "${CAPACITYLENS_MODE:-password-only}");
  assert.equal(
    compose.services.api.environment.CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION,
    "${CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION:-0}",
  );
  assert.deepEqual(Object.keys(compose.volumes).sort(), ["capacitylens-backups", "capacitylens-db"]);
  const workflow = YAML.parse(await readFile(new URL("../.github/workflows/docker.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.equal(Object.hasOwn(workflow.on, "pull_request"), false);
  assert.equal(Object.hasOwn(workflow.on, "workflow_dispatch"), true);
});
