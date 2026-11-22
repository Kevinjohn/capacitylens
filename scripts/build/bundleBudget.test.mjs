import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertEntryBundleWithinBudget,
  ENTRY_GZIP_LIMIT_BYTES,
  ENTRY_RAW_LIMIT_BYTES,
} from './bundleBudget.mjs';

const buildScripts = fileURLToPath(new URL('./', import.meta.url));

// Copies the budget scripts beside a stub build output whose index.html is the given markup.
function arrange(context, html) {
  const directory = mkdtempSync(join(tmpdir(), 'capacitylens-bundle-budget-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'scripts/build'), { recursive: true });
  mkdirSync(join(directory, 'dist/assets'), { recursive: true });
  for (const file of ['bundleBudget.mjs', 'check-bundle-budget.mjs']) {
    cpSync(join(buildScripts, file), join(directory, 'scripts/build', file));
  }
  writeFileSync(join(directory, 'dist/index.html'), html);
  writeFileSync(join(directory, 'dist/assets/app.js'), 'export const app = true\n');
  writeFileSync(join(directory, 'dist/assets/shim.js'), 'export const shim = true\n');
  return spawnSync(process.execPath, ['scripts/build/check-bundle-budget.mjs'], {
    cwd: directory,
    encoding: 'utf8',
  });
}

test('the budget check accepts one module entry regardless of attribute order and quote style', (context) => {
  const result = arrange(context, `<script src='/assets/app.js' crossorigin type='module'></script>`);
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('/assets/app.js'), result.stdout);
});

test('the budget check refuses to guess when two module entries are present', (context) => {
  const result = arrange(
    context,
    `
      <script type="module" src="/assets/shim.js"></script>
      <script type="module" src="/assets/app.js"></script>
    `,
  );
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('expected exactly one JavaScript module entry'), result.stderr);
  assert.ok(result.stderr.includes('found 2'), result.stderr);
});

test('the budget accepts an entry at both boundaries', () => {
  assert.doesNotThrow(() =>
    assertEntryBundleWithinBudget(ENTRY_RAW_LIMIT_BYTES, ENTRY_GZIP_LIMIT_BYTES),
  );
});

test('the budget rejects an entry above the raw boundary', () => {
  assert.throws(
    () => assertEntryBundleWithinBudget(ENTRY_RAW_LIMIT_BYTES + 1, ENTRY_GZIP_LIMIT_BYTES),
    /Bundle budget exceeded/,
  );
});

test('the budget rejects an entry above the gzip boundary', () => {
  assert.throws(
    () => assertEntryBundleWithinBudget(ENTRY_RAW_LIMIT_BYTES, ENTRY_GZIP_LIMIT_BYTES + 1),
    /Bundle budget exceeded/,
  );
});
