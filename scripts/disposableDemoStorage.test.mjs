import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createDisposableDemoStorage } from './disposableDemoStorage.mjs';
import { terminateProcessTree } from './devProcesses.mjs';

const databaseChild = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1]);
db.exec('CREATE TABLE markers (value TEXT)');
process.on('message', (value) => {
  db.prepare('INSERT INTO markers VALUES (?)').run(value);
  process.send({ value, count: db.prepare('SELECT COUNT(*) AS count FROM markers').get().count });
});
process.send({ ready: true });
`;

async function startDatabase(path) {
  const child = spawn(process.execPath, ['-e', databaseChild, path], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const [ready] = await once(child, 'message');
  assert.equal(ready.ready, true);
  return child;
}

async function writeMarker(child, value) {
  const reply = once(child, 'message');
  child.send(value);
  const [result] = await reply;
  assert.equal(result.value, value);
  return result.count;
}

test(
  'concurrent lanes and repeated lanes own distinct writable databases; live groups prevent deletion',
  { timeout: 20_000, skip: process.platform === 'win32' },
  async (context) => {
    const backendDirectory = await mkdtemp(join(tmpdir(), 'capacitylens-demo-storage-'));
    const sentinel = join(backendDirectory, 'unrelated.db');
    await writeFile(sentinel, 'preserve this unrelated dataset');
    const stores = [];
    const children = [];
    context.after(async () => {
      await Promise.all(children.map((child) => terminateProcessTree(child)));
      for (const store of stores) assert.equal(await store.cleanup(children), true);
      await rm(backendDirectory, { recursive: true, force: true });
    });
    stores.push(
      ...(await Promise.all(
        [0, 1, 0].map((lane) => createDisposableDemoStorage(lane, { backendDirectory })),
      )),
    );
    assert.equal(new Set(stores.map((store) => store.databasePath)).size, 3);
    assert.ok(stores.every((store) => store.databasePath.endsWith('/.demo.db')));
    const first = await startDatabase(stores[0].databasePath);
    children.push(first);
    const second = await startDatabase(stores[1].databasePath);
    children.push(second);
    assert.equal(await writeMarker(first, 'first'), 1);
    assert.equal(await writeMarker(second, 'second'), 1);
    assert.equal(
      await stores[0].cleanup([first]),
      false,
      'a surviving owned group prevents storage deletion',
    );
    const later = await createDisposableDemoStorage(0, { backendDirectory });
    stores.push(later);
    assert.notEqual(later.databasePath, stores[0].databasePath);
    assert.equal(await writeMarker(first, 'after another invocation'), 2);
    await terminateProcessTree(first);
    assert.equal(await stores[0].cleanup([first]), true);
    assert.equal(await writeMarker(second, 'unrelated process remains usable'), 2);
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve this unrelated dataset');
  },
);

test('uncertain Windows descendant ownership retains storage', async () => {
  const backendDirectory = await mkdtemp(join(tmpdir(), 'capacitylens-demo-retain-'));
  const store = await createDisposableDemoStorage(0, { backendDirectory, platform: 'win32' });
  try {
    await writeFile(store.databasePath, 'preserve');
    assert.equal(await store.cleanup([{ pid: undefined }]), false);
    assert.equal(await readFile(store.databasePath, 'utf8'), 'preserve');
    assert.equal(await store.cleanup([]), true);
  } finally {
    await rm(backendDirectory, { recursive: true, force: true });
  }
});

test(
  'production refuses before storage or port handling for every bootstrap flag combination',
  { timeout: 20_000 },
  async () => {
    const listener = net.createServer();
    await new Promise((done) => listener.listen(0, '127.0.0.1', done));
    const before = await readdir(new URL('../apps/backend/tmp/', import.meta.url));
    try {
      for (const createAdmin of ['false', 'true']) {
        for (const bootstrapPassword of ['', 'development-password-2026']) {
          const child = spawn(process.execPath, ['scripts/dev-demo.mjs'], {
            env: {
              ...process.env,
              NODE_ENV: 'production',
              CAPACITYLENS_DEV_API_PORT: String(listener.address().port),
              CAPACITYLENS_CREATE_ADMIN_ADMIN: createAdmin,
              CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: bootstrapPassword,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          let error = '';
          child.stderr.on('data', (chunk) => {
            error += chunk;
          });
          const [code] = await once(child, 'exit');
          assert.equal(code, 1);
          assert.match(error, /Disposable demo is forbidden in production/);
        }
      }
      assert.deepEqual(await readdir(new URL('../apps/backend/tmp/', import.meta.url)), before);
    } finally {
      await new Promise((done) => listener.close(done));
    }
  },
);
