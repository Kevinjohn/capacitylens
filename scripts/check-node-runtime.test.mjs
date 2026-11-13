import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertSupportedNodeVersion,
  supportsNodeVersion,
} from '../apps/backend/start/node_version.ts';

test('runtime boundaries reject unsupported versions before application startup', () => {
  for (const version of ['23.9.0', '24.18.9', '25.0.0', '26.8.9', '27.0.0', 'invalid']) {
    assert.equal(supportsNodeVersion(version), false, version);
    assert.throws(() => assertSupportedNodeVersion(version), /CapacityLens requires Node/);
  }
  for (const version of ['24.19.0', '24.21.0', '26.9.0', '26.10.0']) {
    assert.equal(supportsNodeVersion(version), true, version);
    assert.doesNotThrow(() => assertSupportedNodeVersion(version));
  }
});

// A preload reports Node 22 to the entry point under test, so the refusal runs on a supported runtime.
const reportNode22 = `data:text/javascript,${encodeURIComponent(
  "Object.defineProperty(process, 'versions', { value: { ...process.versions, node: '22.23.5' } });",
)}`;

test('the lane launcher refuses an unsupported runtime before starting its command', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      reportNode22,
      fileURLToPath(new URL('./with-lane.mjs', import.meta.url)),
      process.execPath,
      '-e',
      "console.log('command ran')",
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CapacityLens requires Node .*found Node 22\.23\.5/);
  assert.doesNotMatch(result.stdout, /command ran/);
});

test('the backend test entry refuses an unsupported runtime before booting the application', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      '@poppinss/ts-exec',
      '--import',
      reportNode22,
      'bin/test.ts',
      '--files',
      'no-such-spec',
    ],
    {
      cwd: fileURLToPath(new URL('../apps/backend/', import.meta.url)),
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CapacityLens requires Node .*found Node 22\.23\.5/);
  assert.doesNotMatch(result.stdout + result.stderr, /booting application/);
});
