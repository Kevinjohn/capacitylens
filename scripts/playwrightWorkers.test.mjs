import assert from 'node:assert/strict';
import test from 'node:test';
import { browserWorkerCount } from './playwrightWorkers.mjs';

const share = (value) => ({ CAPACITYLENS_TEST_SHARE: String(value) });
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
