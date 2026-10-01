import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  addReleaseFiles,
  assertDeploySucceeded,
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
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, "server", "dist"), { recursive: true });
  await mkdir(join(root, "server", "node_modules", ".pnpm"), { recursive: true });
  await mkdir(join(root, "server", "scripts"), { recursive: true });
  await writeFile(join(root, "dist", "index.html"), "<!doctype html>");
  for (const file of ["index.mjs", "importWorker.mjs", "reset-owner-password.mjs"]) {
    await writeFile(join(root, "server", "dist", file), "export {};");
  }
  await writeFile(join(root, "server", "scripts", "check-node.mjs"), "export {};");
  await addReleaseFiles(root, { repositoryRoot, version: "1.2.3", revision: "abc123" });
  await Promise.all(
    packages.map((name) => mkdir(join(root, "server", "node_modules", ".pnpm", name), { recursive: true })),
  );
  return root;
}

test("accepts the complete production runtime", async (context) => {
  const root = await makeRelease(["better-auth@1.6.30", "fastify@5.12.3"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = await inspectManagedRelease(root, await readDevelopmentPackages(repositoryRoot));
  assert.equal(result.packageCount, 2);
});

test("rejects development tooling in the production runtime", async (context) => {
  const root = await makeRelease(["better-auth@1.6.30", "simple-git-hooks@2.14.0"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  const forbidden = await readDevelopmentPackages(repositoryRoot);
  await assert.rejects(() => inspectManagedRelease(root, forbidden), /simple-git-hooks/);
});

test("rejects transitive tooling from a forbidden scope", async (context) => {
  const root = await makeRelease(["@vitest+runner@4.1.11"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => inspectManagedRelease(root, ["@vitest/"]), /@vitest\//);
});

test("rejects a scoped development package by its store name", async (context) => {
  const root = await makeRelease(["@vitejs+plugin-react@5.0.0"]);
  context.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => inspectManagedRelease(root, ["@vitejs/plugin-react"]), /@vitejs\/plugin-react/);
});

test("forbids the repository's development dependencies but not server runtime dependencies", async () => {
  const forbidden = await readDevelopmentPackages(repositoryRoot);
  for (const tool of [
    "vitest",
    "tsx",
    "esbuild",
    "simple-git-hooks",
    "@playwright/test",
    "@types/",
    "@vitest/",
    "fast-check",
  ]) {
    assert.ok(forbidden.includes(tool), tool);
  }
  for (const runtime of ["fastify", "better-auth", "nodemailer", "date-fns", "@fastify/"]) {
    assert.ok(!forbidden.includes(runtime), runtime);
  }
});

test("does not forbid a development dependency the server also needs at runtime", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "capacitylens-manifest-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "server"));
  await mkdir(join(root, "shared"));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ devDependencies: { yaml: "1", vite: "1", "@fastify/type-provider": "1" } }),
  );
  await writeFile(
    join(root, "server", "package.json"),
    JSON.stringify({ dependencies: { yaml: "1", "@fastify/helmet": "1" }, devDependencies: { tsx: "1" } }),
  );
  await writeFile(join(root, "shared", "package.json"), JSON.stringify({ devDependencies: { "fast-check": "1" } }));
  assert.deepEqual(await readDevelopmentPackages(root), ["@fastify/type-provider", "fast-check", "tsx", "vite"]);
});

test("rejects an artifact without the import worker", async (context) => {
  const root = await makeRelease();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "server", "dist", "importWorker.mjs"), "");
  await assert.rejects(() => inspectManagedRelease(root, []), /importWorker\.mjs/);
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
  assert.match(guide, /releases\/download\/v1\.2\.3\/capacitylens-1\.2\.3\.tar\.gz/);
  assert.doesNotMatch(guide, /X\.Y\.Z/);
  // An isolated site's files are unreadable to the platform's default background-process user.
  assert.match(guide, /Background process \(daemon\):\*\* user: the site's user/);
});

test("ships an environment example whose only blanks are the three values to fill in", async () => {
  const example = await readFile(join(repositoryRoot, "packaging", "release", "capacitylens.env.example"), "utf8");
  const settings = example.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  assert.deepEqual(settings, [
    "NODE_ENV=production",
    "CAPACITYLENS_PUBLIC_URL=",
    "CAPACITYLENS_SECRET=",
    "CAPACITYLENS_SETUP_TOKEN=",
    "CAPACITYLENS_DB=/var/lib/capacitylens/capacitylens.db",
  ]);
  assert.match(example, /^# CAPACITYLENS_MODE=password-only$/m);
  assert.doesNotMatch(example, /openssl/);
});

test("ships a service unit that runs the release with the system Node and the root-only environment", async () => {
  const unit = await readFile(join(repositoryRoot, "packaging", "release", "capacitylens.service"), "utf8");
  for (const line of [
    "User=capacitylens",
    "WorkingDirectory=/opt/capacitylens/current/server",
    "EnvironmentFile=/etc/capacitylens.env",
    "Environment=NODE_ENV=production",
    "ExecStartPre=/usr/bin/env node /opt/capacitylens/current/server/scripts/check-node.mjs",
    "ExecStart=/usr/bin/env node /opt/capacitylens/current/server/dist/index.mjs",
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
  const guide = await readFile(join(repositoryRoot, "packaging", "release", "INSTALL.md"), "utf8");
  const managedHostSite = guide.match(/```nginx\n([\s\S]*?)```/)?.[1] ?? "";
  assert.deepEqual(silenced(managedHostSite), silenced(site));
  assert.match(site, /client_max_body_size 6m;/);
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
