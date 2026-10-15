import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

test("native compilation tools are installed before dependencies and stay outside the runtime stage", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const stages = dockerfile.split(/(?=^FROM )/m);
  const dependencies = stages.find((stage) => / AS deps\n/.test(stage));
  const runtime = stages.find((stage) => / AS api\n/.test(stage));
  assert.ok(dependencies);
  assert.ok(runtime);
  assert.match(dependencies, /apt-get install --yes --no-install-recommends python3 make g\+\+/);
  assert.ok(dependencies.indexOf("apt-get install") < dependencies.indexOf("pnpm install --frozen-lockfile"));
  assert.match(runtime, /^FROM public\.ecr\.aws\/docker\/library\/node:[^\n]+ AS api/m);
  assert.doesNotMatch(runtime, /\b(?:python3|make|build-essential)\b|g\+\+/);
  const copies = [...runtime.matchAll(/^COPY --from=(.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(copies, ["server-deploy /prod/backend ./"]);
});

test("the web image copies the Vite output consumed by the root standalone build", async () => {
  const ts = await import("typescript");
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const configPath = join(repository, "apps/frontend/vite.config.ts");
  const source = ts.createSourceFile(configPath, await readFile(configPath, "utf8"), ts.ScriptTarget.Latest, true);
  const outputDirectories = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === "outDir" && ts.isStringLiteral(node.initializer))
      outputDirectories.push(node.initializer.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(outputDirectories.length, 1);
  const output = resolve(repository, "apps/frontend", outputDirectories[0]);
  const containerOutput = `/app/${relative(repository, output).replaceAll("\\", "/")}`;
  const dockerfile = await readFile(join(repository, "Dockerfile"), "utf8");
  assert.ok(dockerfile.includes(`COPY --from=web-build ${containerOutput} /usr/share/nginx/html`));
  const manifest = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const build = manifest.scripts.build;
  assert.ok(build.indexOf("pnpm --dir apps/frontend build") < build.indexOf("node scripts/sync-adonis-public.mjs"));
  assert.ok(build.indexOf("node scripts/sync-adonis-public.mjs") < build.indexOf("pnpm --dir apps/backend build"));
  const sync = await readFile(join(repository, "scripts/sync-adonis-public.mjs"), "utf8");
  const syncedSource = /await cp\(new URL\("([^"]+)"/.exec(sync)?.[1];
  assert.ok(syncedSource);
  assert.equal(
    fileURLToPath(new URL(syncedSource, new URL("../scripts/sync-adonis-public.mjs", import.meta.url))),
    `${output}/`,
  );
});
