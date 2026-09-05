import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { classifyRepositoryPath, collectSourceInventory } from "./source-inventory.mjs";

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "source-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  return root;
}

function put(root, path, content = "") {
  const destination = join(root, path);
  mkdirSync(join(destination, ".."), { recursive: true });
  writeFileSync(destination, content);
}

test("classifies source formats independently of their current directory", () => {
  for (const [path, language, role] of [
    ["new/module.ts", "typescript", "production"],
    ["server/scripts/rehearse/anonymise.ts", "typescript", "production"],
    ["src/components/ui/sidebar.tsx", "typescript", "production"],
    ["public/offline-worker.js", "javascript", "production"],
    ["scripts/check-file-sizes.mjs", "javascript", "production"],
    ["tool.cjs", "javascript", "production"],
    ["tool.cts", "typescript", "production"],
    ["view.jsx", "javascript", "production"],
    ["docs-src/.vitepress/config.mts", "typescript", "production"],
    ["docs-src/.vitepress/theme/Breadcrumbs.vue", "vue", "production"],
    ["scripts/internal-tls.sh", "shell", "production"],
    ["src/index.css", "css", "production"],
    ["index.html", "html", "production"],
    ["src/model.test.ts", "typescript", "test"],
    ["server/model.spec.ts", "typescript", "test"],
    ["e2e/helpers.ts", "typescript", "test"],
    ["src/test/setup.ts", "typescript", "test"],
    ["src/components/scheduler/__tests__/schedulerTestKit.tsx", "typescript", "test"],
    ["server/src/fixtures/credentialOnboardingCrashFixture.ts", "typescript", "test"],
    ["new/fixtures/model.ts", "typescript", "production"],
    ["scripts/dependency-scanner.d.mts", "typescript", "declaration"],
    ["types.d.cts", "typescript", "declaration"],
    ["types.d.ts", "typescript", "declaration"],
  ]) {
    assert.deepEqual(classifyRepositoryPath(path), { category: "source", language, role }, path);
  }
});

test("classifies known non-source formats and generated roots explicitly", () => {
  for (const [path, category] of [
    ["docs/reference/development.html", "generated"],
    ["src/paraglide/messages.js", "generated"],
    ["README.md", "prose"],
    ["LICENSE", "prose"],
    ["messages/en.json", "data"],
    [".zap/rules.tsv", "data"],
    ["server/fixtures/released.db", "asset"],
    ["public/icon.svg", "asset"],
    ["image.jpg", "asset"],
    ["font.woff2", "asset"],
    [".github/workflows/gate.yml", "configuration"],
    ["pnpm-lock.yaml", "configuration"],
    [".gitleaks.toml", "configuration"],
    [".env.example", "configuration"],
    ["Dockerfile", "configuration"],
    ["server/.gitignore", "configuration"],
    ["nginx.conf", "configuration"],
    ["nginx.client.conf.template", "configuration"],
    ["patches/sonner@2.0.8.patch", "patch"],
  ])
    assert.equal(classifyRepositoryPath(path).category, category, path);
});

test("rejects unknown formats and nonportable or escaping paths", () => {
  for (const path of ["new.py", "script", "source.ts.bak", "new.conf.template", "image.unknown"]) {
    assert.throws(() => classifyRepositoryPath(path), /Unclassified repository path/, path);
  }
  for (const path of ["", "/src/a.ts", "../a.ts", "src/../a.ts", "src//a.ts", "./a.ts", "src\\a.ts", "C:/a.ts"]) {
    assert.throws(() => classifyRepositoryPath(path), /Invalid repository path/, path);
  }
});

test("includes tracked and new files once, excludes ignored files, and sorts by path", (t) => {
  const root = repository(t);
  put(root, ".gitignore", "ignored/\n");
  put(root, "tracked.ts", "export const value = 1;\n");
  execFileSync("git", ["add", "."], { cwd: root });
  put(root, "new folder/view.tsx");
  put(root, "ignored/unknown.py");
  const inventory = collectSourceInventory(root);
  assert.deepEqual(
    inventory.map(({ path }) => path),
    [".gitignore", "new folder/view.tsx", "tracked.ts"],
  );
  assert.equal(inventory[1].category, "source");
});

test("unknown untracked files fail the inventory", (t) => {
  const root = repository(t);
  put(root, "new.py");
  assert.throws(() => collectSourceInventory(root), /Unclassified repository path: new.py/);
});

test("rejects symlinks instead of treating their targets as repository source", (t) => {
  const root = repository(t);
  put(root, "actual.ts");
  symlinkSync("actual.ts", join(root, "alias.ts"));
  assert.throws(() => collectSourceInventory(root), /Unsupported repository entry: alias.ts/);
});

test("omits deleted tracked files and reports git discovery failures", (t) => {
  const root = repository(t);
  put(root, "removed.ts");
  execFileSync("git", ["add", "."], { cwd: root });
  rmSync(join(root, "removed.ts"));
  assert.deepEqual(collectSourceInventory(root), []);
  rmSync(join(root, ".git"), { recursive: true });
  assert.throws(() => collectSourceInventory(root), /git ls-files failed/);
});

test("the current repository has no unclassified files and includes source-owned primitives", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const inventory = collectSourceInventory(root);
  assert.equal(inventory.find(({ path }) => path === "src/components/ui/sidebar.tsx").category, "source");
  assert.equal(inventory.find(({ path }) => path === "scripts/source-inventory.test.mjs").role, "test");
});

test("CLI emits readable or machine-readable inventory and fails on unknown files or arguments", (t) => {
  const root = repository(t);
  mkdirSync(join(root, "scripts"));
  const cli = join(root, "scripts/source-inventory.mjs");
  copyFileSync(fileURLToPath(new URL("./source-inventory.mjs", import.meta.url)), cli);
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: "utf8", stdio: "pipe" });
  assert.match(run(), /Source inventory passed \(files: 1\)/);
  assert.deepEqual(JSON.parse(run("--json")), [
    { path: "scripts/source-inventory.mjs", category: "source", language: "javascript", role: "production" },
  ]);
  assert.throws(() => run("--unknown"), /Expected no arguments or --json/);
  put(root, "new.py");
  assert.throws(() => run(), /Unclassified repository path: new.py/);
});
