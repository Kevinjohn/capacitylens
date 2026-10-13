import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arch, platform } from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import YAML from "yaml";

import {
  addReleaseFiles,
  assertDeploySucceeded,
  carryBuildPolicy,
  inspectArchiveTree,
  inspectManagedRelease,
  packageManagedRelease,
  readDevelopmentPackages,
  requireNonemptyFile,
  resetGeneratedOutput,
  sha256File,
} from "./package-managed-release.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

async function makeRelease(packages = []) {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-release-test-"));
  await mkdir(join(root, "backend", "public", "assets"), { recursive: true });
  await mkdir(join(root, "backend", "bin"), { recursive: true });
  await mkdir(join(root, "backend", "database", "migrations"), { recursive: true });
  await mkdir(join(root, "backend", "node_modules", ".pnpm"), { recursive: true });
  await mkdir(join(root, "backend", "node_modules", "@capacitylens", "shared", "dist"), { recursive: true });
  await mkdir(join(root, "backend", "node_modules", "better-sqlite3", "prebuilds"), { recursive: true });
  for (const file of [
    ["public", "index.html"],
    ["public", "assets", "app.js"],
    ["bin", "server.js"],
    ["ace.js"],
    ["database", "released.json"],
    ["database", "migrations", "1_initial.js"],
    ["pnpm-workspace.yaml"],
    ["node_modules", "@capacitylens", "shared", "dist", "brand.js"],
    ["node_modules", "better-sqlite3", "prebuilds", `${platform}-${arch}.node`],
  ]) {
    await writeFile(join(root, "backend", ...file), "fixture");
  }
  await writeFile(
    join(root, "backend", "database", "released.json"),
    JSON.stringify({ version: 1, migrations: [{ name: "database/migrations/1_initial", sha256: "abc" }] }),
  );
  await addReleaseFiles(root, { repositoryRoot, version: "1.2.3", revision: "abc123" });
  for (const name of packages) {
    await mkdir(join(root, "backend", "node_modules", ".pnpm", name), { recursive: true });
  }
  return root;
}

test("accepts the complete production runtime", async (context) => {
  const root = await makeRelease(["@adonisjs+core@7.5.2", "better-sqlite3@13.0.3"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = await inspectManagedRelease(root, await readDevelopmentPackages(repositoryRoot));
  assert.equal(result.packageCount, 2);
});

test("carries only the approved build-script policy from the deploy", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-policy-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const backend = join(root, "backend");
  const deployment = join(root, "deploy");
  await mkdir(backend);
  await mkdir(deployment);
  const policy = { "@swc/core": true, "better-sqlite3": true, esbuild: true, "simple-git-hooks": false };
  await writeFile(join(root, "pnpm-workspace.yaml"), YAML.stringify({ packages: ["apps/*"], allowBuilds: policy }));
  await writeFile(
    join(deployment, "pnpm-workspace.yaml"),
    YAML.stringify({
      patchedDependencies: { "sonner@2": "../../outside.patch" },
      allowBuilds: policy,
    }),
  );
  await carryBuildPolicy(backend, root, deployment);
  const carried = await readFile(join(backend, "pnpm-workspace.yaml"), "utf8");
  assert.deepEqual(YAML.parse(carried), { allowBuilds: policy });
  assert.doesNotMatch(carried, /outside|packages:|patchedDependencies:/);
  await writeFile(join(deployment, "pnpm-workspace.yaml"), YAML.stringify({ allowBuilds: { esbuild: false } }));
  await assert.rejects(() => carryBuildPolicy(backend, root, deployment), /build-script policy differs/);
});

test("rejects a direct development-tool link in the production runtime", async (context) => {
  const root = await makeRelease(["@adonisjs+core@7.5.2", "simple-git-hooks@2.14.0"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  await symlink(".pnpm/simple-git-hooks@2.14.0", join(root, "backend", "node_modules", "simple-git-hooks"));
  const forbidden = await readDevelopmentPackages(repositoryRoot);
  await assert.rejects(() => inspectManagedRelease(root, forbidden), /simple-git-hooks/);
});

test("allows transitively installed tooling required by the framework runtime", async (context) => {
  const root = await makeRelease(["@vitest+runner@4.1.11"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  await inspectManagedRelease(root, ["@vitest/"]);
});

test("rejects a direct scoped development-tool link", async (context) => {
  const root = await makeRelease(["@vitejs+plugin-react@5.0.0"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "backend", "node_modules", "@vitejs"));
  await symlink(
    "../.pnpm/@vitejs+plugin-react@5.0.0",
    join(root, "backend", "node_modules", "@vitejs", "plugin-react"),
  );
  await assert.rejects(() => inspectManagedRelease(root, ["@vitejs/plugin-react"]), /@vitejs\/plugin-react/);
});

test("rejects generated test code and application source maps", async (context) => {
  const root = await makeRelease();
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "backend", "tests"));
  await assert.rejects(() => inspectManagedRelease(root, []), /compiled tests/);
  await rm(join(root, "backend", "tests"), { recursive: true });
  await writeFile(join(root, "backend", "bin", "server.js.map"), "source map");
  await assert.rejects(() => inspectManagedRelease(root, []), /source map/);
});

test("forbids the repository's development dependencies but not server runtime dependencies", async () => {
  const forbidden = await readDevelopmentPackages(repositoryRoot);
  for (const tool of [
    "vitest",
    "typescript",
    "@adonisjs/assembler",
    "simple-git-hooks",
    "@playwright/test",
    "@types/",
    "@vitest/",
    "fast-check",
  ]) {
    assert.ok(forbidden.includes(tool), tool);
  }
  for (const runtime of ["@adonisjs/core", "@adonisjs/lucid", "better-sqlite3", "@capacitylens/shared"]) {
    assert.ok(!forbidden.includes(runtime), runtime);
  }
});

test("does not forbid a development dependency the server also needs at runtime", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-manifest-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "apps", "backend"), { recursive: true });
  await mkdir(join(root, "packages", "shared"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ devDependencies: { yaml: "1", vite: "1", "@fastify/type-provider": "1" } }),
  );
  await writeFile(
    join(root, "apps", "backend", "package.json"),
    JSON.stringify({ dependencies: { yaml: "1", "@fastify/helmet": "1" }, devDependencies: { tsx: "1" } }),
  );
  await writeFile(
    join(root, "packages", "shared", "package.json"),
    JSON.stringify({ devDependencies: { "fast-check": "1" } }),
  );
  assert.deepEqual(await readDevelopmentPackages(root), ["@fastify/type-provider", "fast-check", "tsx", "vite"]);
});

test("rejects an artifact without the executable migration manifest", async (context) => {
  const root = await makeRelease();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "backend", "database", "released.json"), "");
  await assert.rejects(() => inspectManagedRelease(root, []), /released\.json/);
});

test("rejects an artifact missing its frontend, compiled shared runtime, or SQLite addon", async (context) => {
  const root = await makeRelease();
  context.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, label] of [
    ["backend/public/index.html", /index\.html/],
    ["backend/node_modules/@capacitylens/shared/dist/brand.js", /shared/],
    [`backend/node_modules/better-sqlite3/prebuilds/${platform}-${arch}.node`, /native addon/],
  ]) {
    const path = join(root, file);
    const contents = await readFile(path);
    await writeFile(path, "");
    await assert.rejects(() => inspectManagedRelease(root, []), label);
    await writeFile(path, contents);
  }
});

test("rejects every output path except the dedicated production directory", async () => {
  await assert.rejects(() => packageManagedRelease("dist"), /exactly production/);
  await assert.rejects(() => packageManagedRelease("../outside"), /exactly production/);
});

test("does not delete an unowned production directory", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-output-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "production");
  await mkdir(output);
  await writeFile(join(output, "keep.txt"), "operator data");

  await assert.rejects(() => resetGeneratedOutput(output), /not a CapacityLens-generated artifact/);
  assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "operator data");
  assert.deepEqual(await readdir(root), ["production"]);
});

test("replaces only a marked generated artifact", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-output-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "production");

  await resetGeneratedOutput(output);
  await writeFile(join(output, "stale.txt"), "stale");
  await resetGeneratedOutput(output);

  await assert.rejects(() => readFile(join(output, "stale.txt")), /ENOENT/);
  assert.deepEqual(await readdir(root), ["production"]);
  assert.match(await readFile(join(output, ".capacitylens-generated-release"), "utf8"), /generated/);
});

test("does not follow a production-directory symlink", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-output-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target");
  const output = join(root, "production");
  await resetGeneratedOutput(target);
  await symlink(target, output);

  await assert.rejects(() => resetGeneratedOutput(output), /not a generated directory/);
  assert.match(await readFile(join(target, ".capacitylens-generated-release"), "utf8"), /generated/);
});

test("reports an unreadable marker as itself and leaves production/ in place", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-output-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, "production");
  await mkdir(join(output, ".capacitylens-generated-release"), { recursive: true });

  await assert.rejects(() => resetGeneratedOutput(output), { code: "EISDIR" });
  assert.deepEqual(await readdir(root), ["production"]);
});

test("reports an uninspectable artifact file as itself, not as missing", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-release-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "dist"), "a file where a directory belongs");
  const path = join(root, "dist", "index.html");

  await assert.rejects(
    () => requireNonemptyFile(path, "dist/index.html"),
    (error) => {
      assert.equal(error.cause?.code, "ENOTDIR");
      assert.match(error.message, /Could not inspect .*index\.html/);
      return true;
    },
  );
  await assert.rejects(() => requireNonemptyFile(join(root, "absent"), "absent"), /missing absent/);
});

test("reports a deploy that could not start or was terminated before its status", () => {
  const cause = Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" });
  assert.throws(
    () => assertDeploySucceeded({ error: cause, status: null, signal: null }),
    (error) => {
      assert.equal(error.cause, cause);
      assert.match(error.message, /could not start: spawn pnpm ENOENT/);
      return true;
    },
  );
  assert.throws(() => assertDeploySucceeded({ status: null, signal: "SIGTERM" }), /terminated by SIGTERM/);
  assert.throws(() => assertDeploySucceeded({ status: 1, signal: null }), /failed with status 1/);
  assert.doesNotThrow(() => assertDeploySucceeded({ status: 0, signal: null }));
});

test("rejects an artifact without an operator file", async (context) => {
  const root = await makeRelease();
  context.after(() => rm(root, { recursive: true, force: true }));
  await rm(join(root, "capacitylens.service"));
  await assert.rejects(() => inspectManagedRelease(root, []), /capacitylens\.service/);
});

test("adds the operator files, the exact version to the guide and the source revision", async (context) => {
  const root = await makeRelease();
  context.after(() => rm(root, { recursive: true, force: true }));
  const shipped = (await readdir(join(repositoryRoot, "packaging", "release"))).sort();
  const released = await readdir(root);
  for (const file of shipped) assert.ok(released.includes(file), file);
  assert.equal(await readFile(join(root, "VERSION"), "utf8"), "version=1.2.3\nrevision=abc123\n");
  const guide = await readFile(join(root, "INSTALL.md"), "utf8");
  assert.match(guide, /capacitylens-1\.2\.3\.tar\.gz/);
  assert.doesNotMatch(guide, /X\.Y\.Z/);
  assert.match(guide, /--uid=capacitylens/);
  assert.match(guide, /EnvironmentFile=\/etc\/capacitylens\.env/);
  assert.match(guide, /ace\.js app:upgrade/);
  assert.match(guide, /\/opt\/capacitylens\/current\/backend/);
  assert.match(guide, /current backend uses open local access/);
});

test("ships an environment example with explicit current production posture", async () => {
  const example = await readFile(join(repositoryRoot, "packaging", "release", "capacitylens.env.example"), "utf8");
  const settings = example.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  assert.deepEqual(settings, [
    "NODE_ENV=production",
    "HOST=127.0.0.1",
    "PORT=8787",
    "LOG_LEVEL=info",
    "APP_URL=https://capacity.example.com",
    "APP_KEY=",
    "SESSION_DRIVER=cookie",
    "CAPACITYLENS_MODE=off",
    "CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1",
    "CAPACITYLENS_AUDIT=on",
    "CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db",
    "CAPACITYLENS_BACKUP_DIR=/var/lib/capacitylens/backups",
    "CAPACITYLENS_BACKUP_INTERVAL_MIN=60",
  ]);
});

test("ships a service unit that runs the release with the system Node and the root-only environment", async () => {
  const unit = await readFile(join(repositoryRoot, "packaging", "release", "capacitylens.service"), "utf8");
  for (const line of [
    "User=capacitylens",
    "WorkingDirectory=/opt/capacitylens/current/backend",
    "EnvironmentFile=/etc/capacitylens.env",
    "Environment=NODE_ENV=production",
    "ExecStart=/usr/bin/env node /opt/capacitylens/current/backend/bin/server.js",
    "TimeoutStopSec=30",
    "Restart=on-failure",
  ]) {
    assert.match(unit, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m"), line);
  }
});

const headerValues = (conf) =>
  Object.fromEntries(
    [...conf.matchAll(/^\s*add_header\s+(\S+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))(?:\s+always)?;/gm)].map((match) => [
      match[1],
      match[2] ?? match[3] ?? match[4],
    ]),
  );

test("keeps the shipped nginx site's headers and log suppression in step with the packaged edge", async () => {
  const site = await readFile(join(repositoryRoot, "packaging", "release", "capacitylens.nginx.conf"), "utf8");
  const edge = await readFile(join(repositoryRoot, "nginx.conf"), "utf8");
  const expected = headerValues(await readFile(join(repositoryRoot, "nginx-security-headers.conf"), "utf8"));
  expected["Content-Security-Policy"] = expected["Content-Security-Policy"].replace(
    "$capacitylens_connect_src",
    "'self'",
  );
  // The site is the TLS edge itself, so HSTS is host-only, as the server's own header is.
  expected["Strict-Transport-Security"] = "max-age=63072000";
  expected["Cache-Control"] = "$capacitylens_cache_control";
  assert.deepEqual(headerValues(site), expected);

  const silenced = (conf) => [...conf.matchAll(/location\s+(~[^{]*)\{\s*access_log off;/g)].map((match) => match[1]);
  assert.equal(silenced(edge).length, 3);
  assert.deepEqual(silenced(site), silenced(edge));
  assert.match(site, /client_max_body_size 6m;/);
  assert.match(site, /root \/opt\/capacitylens\/current\/backend\/public;/);
  const health = site.match(/location \^~ \/health\/ \{([^}]*)\}/)?.[1];
  assert.ok(health, "Native health routes must be proxied to the backend.");
  assert.match(health, /proxy_pass http:\/\/127\.0\.0\.1:8787;/);
  assert.doesNotMatch(health, /try_files|add_header/);
  assert.match(site, /proxy_read_timeout 130s;/);
  assert.match(site, /return 301 https:\/\/\$host\$request_uri;/);
});

test("refuses operator state and symlinks that leave the release", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-archive-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "server", "node_modules", ".pnpm", "fastify@5", "node_modules", "fastify"), {
    recursive: true,
  });
  // pnpm's own relative links stay inside the release and are kept.
  await symlink(".pnpm/fastify@5/node_modules/fastify", join(root, "server", "node_modules", "fastify"));
  await writeFile(join(root, "capacitylens.env.example"), "NODE_ENV=production\n");
  await writeFile(join(root, ".env.example"), "");
  await inspectArchiveTree(root);

  for (const [entry, reason] of [
    [".env", /\.env is an environment file/],
    ["capacitylens.env", /capacitylens\.env is an environment file/],
    ["capacitylens.db", /is a database file/],
    ["capacitylens.db-wal", /is a database file/],
    ["capacitylens-audit.jsonl.1", /is an audit log/],
  ]) {
    await writeFile(join(root, "server", entry), "operator state");
    await assert.rejects(() => inspectArchiveTree(root), reason, entry);
    await rm(join(root, "server", entry));
  }
  await mkdir(join(root, "server", "backups"));
  await assert.rejects(() => inspectArchiveTree(root), /server\/backups is a backup directory/);
  await rm(join(root, "server", "backups"), { recursive: true });

  await symlink("../../outside", join(root, "server", "escape"));
  await assert.rejects(() => inspectArchiveTree(root), /server\/escape links outside the release/);
  await rm(join(root, "server", "escape"));
  await symlink("/etc/passwd", join(root, "absolute"));
  await assert.rejects(() => inspectArchiveTree(root), /absolute links outside the release/);
});

test("writes checksums in sha256sum format", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-checksum-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "abc"), "abc");
  assert.equal(await sha256File(join(root, "abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
