import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserWorkerCount,
  configurationWorkerCount,
  E2E_GUARDIAN_MEMORY_BYTES,
  WORKER_MEMORY_BYTES,
} from './playwrightWorkers.mjs';

const share = (value) => ({ CAPACITYLENS_TEST_SHARE: String(value) });
test('worker admission includes memory reserved for both runtime guardians', () => {
  assert.equal(E2E_GUARDIAN_MEMORY_BYTES, 2 * 64 * 1024 ** 2);
  assert.equal(WORKER_MEMORY_BYTES, (671568 + 890832 + 1537376) * 1024 + E2E_GUARDIAN_MEMORY_BYTES);
});

test('memory, CPU reservation and worker endpoints each bound the count', () => {
  assert.equal(
    browserWorkerCount(share(8), { freeBytes: 9_000, workerBytes: 1_000, reservedBytes: 0 }),
    8,
  );
  assert.equal(
    browserWorkerCount(share(8), { freeBytes: 7_999, workerBytes: 1_000, reservedBytes: 0 }),
    7,
  );
  assert.equal(
    browserWorkerCount(share(80), { freeBytes: 99_000, workerBytes: 1_000, reservedBytes: 0 }),
    50,
  );
  assert.equal(
    browserWorkerCount(share(1), { freeBytes: 1_000, workerBytes: 1_000, reservedBytes: 0 }),
    1,
  );
});
test('insufficient memory fails before a zero worker configuration can start', () => {
  assert.throws(
    () =>
      browserWorkerCount(share(8), {
        freeBytes: 1024 ** 2,
        workerBytes: 2 * 1024 ** 2,
        reservedBytes: 0,
      }),
    /insufficient memory for one worker: needs 2 MB, has 1 MB/,
  );
  assert.throws(
    () => browserWorkerCount(share(8), { freeBytes: 1, workerBytes: 0, reservedBytes: 0 }),
    RangeError,
  );
});

test('shared authentication servers consume memory before worker admission', () => {
  assert.equal(
    browserWorkerCount(share(8), { freeBytes: 4_000, workerBytes: 1_000, reservedBytes: 1_001 }),
    2,
  );
  assert.throws(
    () =>
      browserWorkerCount(share(8), { freeBytes: 1_500, workerBytes: 1_000, reservedBytes: 1_000 }),
    /insufficient memory/,
  );
});

test('worker configuration reloads reuse coordinator admission after server memory is consumed', () => {
  const environment = { ...share(8), CAPACITYLENS_E2E_ADMITTED_WORKERS: '50' };
  const memory = { freeBytes: 4_000, workerBytes: 1_000, reservedBytes: 1_000 };
  assert.equal(
    configurationWorkerCount(environment, memory),
    3,
    'a fresh coordinator ignores stale ambient admission',
  );
  const worker = { ...environment, TEST_WORKER_INDEX: '0' };
  assert.equal(configurationWorkerCount(worker, { ...memory, freeBytes: 0 }), 3);
  assert.throws(
    () => configurationWorkerCount({ ...environment }, { ...memory, freeBytes: 0 }),
    /insufficient memory/,
  );
  for (const invalid of [undefined, '0', '-1', '1.5', '51', '1junk'])
    assert.throws(
      () =>
        configurationWorkerCount({ ...worker, CAPACITYLENS_E2E_ADMITTED_WORKERS: invalid }, memory),
      /valid coordinator memory admission/,
    );
});
