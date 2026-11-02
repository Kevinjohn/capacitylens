import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertNoStyleViolations, assertStrictStylePolicy } from './smoke-packaged-dialogs.mjs';

const policy =
  "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'";

test('production dialog acceptance refuses absent or weakened stylesheet policy', () => {
  assert.doesNotThrow(() => assertStrictStylePolicy(policy));
  for (const weakened of [
    undefined,
    "default-src 'self'",
    policy.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"),
    `${policy}; style-src-elem 'unsafe-inline'`,
  ]) {
    assert.throws(() => assertStrictStylePolicy(weakened));
  }
});

test('production dialog acceptance fails on an observed blocked runtime style', () => {
  assert.doesNotThrow(() => assertNoStyleViolations([]));
  assert.throws(
    () => assertNoStyleViolations([{ directive: 'style-src-elem', blocked: 'inline' }]),
    /production browser blocked an application stylesheet/,
  );
});

test('production dialog acceptance names its own command when the artifact path is missing', () => {
  const script = fileURLToPath(new URL('./smoke-packaged-dialogs.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Usage: pnpm run smoke:packaged-dialogs <extracted-artifact>\/backend/,
  );
});
