import { test } from '@japa/runner';
import type { TestContext } from '@japa/runner/core';
import { mock } from 'node:test';
import app from '@adonisjs/core/services/app';
import type { ApplicationService } from '@adonisjs/core/types';
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error better-sqlite3 does not publish declarations
import Database from 'better-sqlite3';
import {
  defineConfig,
  listBundles,
  prepareDirectory,
  SqliteBackup,
  verifyBundle,
  type CreateResult,
} from '@kevinjohn/adonisjs-sqlite-backup';
import BackupProvider from '#providers/backup_provider';
import { operatorFixture } from './operator_command_support.js';

function makeApplication(
  backup: BackupService,
  environment = 'web',
  directory = backup.config.directory
) {
  return {
    getEnvironment: () => environment,
    config: {
      get: (key: string) => (key === 'backup' ? { ...backup.config, directory } : undefined),
    },
    container: {
      make: async (key: string) => {
        if (key !== 'sqlite.backup') throw new Error(`Unexpected binding ${key}`);
        return backup;
      },
    },
  } as unknown as ApplicationService;
}

type BackupService = Pick<
  SqliteBackup,
  'config' | 'livePath' | 'checkSource' | 'prepareDirectory' | 'create' | 'prune'
>;
const DAY_MS = 24 * 60 * 60_000;

class LoggedProvider extends BackupProvider {
  messages: string[] = [];
  protected log(message: string) {
    this.messages.push(message);
  }
}

function useClock({ cleanup }: TestContext) {
  mock.timers.enable({ apis: ['setInterval'] });
  cleanup(() => mock.timers.reset());
  return mock.timers;
}

const created: CreateResult = {
  name: 'bak-utc-20261108-000000-000',
  path: '/test/backups/bundle',
  createdAt: '2026-11-08T00:00:00.000Z',
  manifest: {
    format: 1,
    createdAt: '2026-11-08T00:00:00.000Z',
    bytes: 0,
    sha256: '0'.repeat(64),
    sourceJournalMode: 'wal',
  },
  warnings: [],
};

function makeBackup(events: string[]): BackupService {
  return {
    config: defineConfig({ directory: '/test/backups' }),
    livePath: () => '/test/live.db',
    checkSource: () => void events.push('source'),
    prepareDirectory: () => void events.push('directory'),
    create: async () => {
      events.push('create');
      return created;
    },
    prune: () => {
      events.push('prune');
      return { removed: [], abandoned: [], failed: [] };
    },
  };
}

function makeRealBackup(root: string, directory = join(root, 'backups')) {
  const path = join(root, 'source.db');
  const database = new Database(path);
  database.pragma('journal_mode = WAL');
  database.exec(
    "CREATE TABLE adonis_schema(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO adonis_schema VALUES(1,'baseline'); CREATE TABLE entries(id INTEGER PRIMARY KEY)"
  );
  database.close();
  return new SqliteBackup(defineConfig({ directory, keep: 2 }), {
    connection: 'sqlite',
    connections: { sqlite: { client: 'better-sqlite3', connection: { filename: path } } },
  });
}

test('one real scheduled backup verifies and a missing root fails without recreating it', async (context) => {
  const { assert, cleanup } = context;
  const clock = useClock(context);
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-provider-'));
  const backup = makeRealBackup(root);
  const create = backup.create.bind(backup);
  let startupCalled = false;
  backup.create = (options) => {
    startupCalled = true;
    return create(options);
  };
  const provider = new LoggedProvider(makeApplication(backup));
  cleanup(async () => {
    await provider.shutdown();
    rmSync(root, { recursive: true, force: true });
  });
  await provider.ready();
  assert.isTrue(startupCalled, 'startup invoked the real package create');
  const pending = provider.runBackup();
  await provider.ready();
  assert.strictEqual(provider.runBackup(), pending);
  const result = await pending;
  assert.equal(verifyBundle(backup.config.directory, result.name).path, result.path);
  assert.lengthOf(listBundles(backup.config.directory), 1);
  rmSync(backup.config.directory, { recursive: true });
  clock.tick(DAY_MS);
  await assert.rejects(() => provider.runBackup(), /backup directory.*missing/);
  assert.isFalse(existsSync(backup.config.directory));
  assert.isTrue(provider.messages.some((message) => message.includes('backup FAILED')));
  await provider.shutdown();
  await assert.rejects(() => provider.runBackup(), /stopped/);
});

test('the provider schedules only enabled web applications', async (context) => {
  const { assert } = context;
  const clock = useClock(context);
  const events: string[] = [];
  for (const [environment, directory] of [
    ['console', '/test/backups'],
    ['test', '/test/backups'],
    ['web', ''],
  ]) {
    const provider = new LoggedProvider(
      makeApplication(makeBackup(events), environment, directory)
    );
    await provider.ready();
    clock.tick(DAY_MS);
    await Promise.resolve();
    assert.deepEqual(events, []);
    assert.deepEqual(provider.messages, []);
    await provider.shutdown();
  }
});

test('startup refuses a backup directory that contains the live database', async (context) => {
  const { assert, cleanup } = context;
  const root = mkdtempSync(join(tmpdir(), 'capacitylens-provider-'));
  cleanup(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o755);
  const backup = makeRealBackup(root, root);
  let createCalled = false;
  backup.create = async () => {
    createCalled = true;
    throw new Error('unexpected create');
  };
  const provider = new LoggedProvider(makeApplication(backup, 'web', root));
  await assert.rejects(
    () => provider.ready(),
    /CAPACITYLENS_BACKUP_DIR=.*could not be initialized: backup directory contains the live database/
  );
  assert.isFalse(createCalled);
  assert.equal(statSync(root).mode & 0o777, 0o755, 'refusal precedes directory preparation');
  await provider.shutdown();
});

for (const phase of ['source', 'directory'] as const) {
  test(`startup ${phase} failure is fatal before scheduling`, async (context) => {
    const { assert } = context;
    const clock = useClock(context);
    const events: string[] = [];
    const backup = makeBackup(events);
    backup[phase === 'source' ? 'checkSource' : 'prepareDirectory'] = () => {
      events.push(phase);
      throw new Error(`${phase} unavailable`);
    };
    const provider = new LoggedProvider(makeApplication(backup));
    await assert.rejects(
      () => provider.ready(),
      new RegExp(`CAPACITYLENS_BACKUP_DIR=.*could not be initialized: ${phase} unavailable`)
    );
    clock.tick(DAY_MS);
    await Promise.resolve();
    assert.deepEqual(provider.messages, []);
    assert.deepEqual(events, phase === 'source' ? ['source'] : ['source', 'directory']);
    await provider.shutdown();
  });
}

test('startup and daily runs skip in-flight work, and shutdown cancels and drains', async (context) => {
  const { assert, cleanup } = context;
  const clock = useClock(context);
  const events: string[] = [];
  const backup = makeBackup(events);
  const pending = Promise.withResolvers<CreateResult>();
  backup.create = () => {
    events.push('create');
    return pending.promise;
  };
  const provider = new LoggedProvider(makeApplication(backup));
  cleanup(async () => {
    pending.resolve(created);
    await provider.shutdown();
  });
  await provider.ready();
  await provider.ready();
  assert.deepEqual(events, ['source', 'directory', 'create']);
  const active = provider.runBackup();
  clock.tick(DAY_MS - 1);
  assert.deepEqual(provider.messages, []);
  clock.tick(1);
  assert.deepEqual(events, ['source', 'directory', 'create']);
  assert.deepEqual(provider.messages, ['backup skipped — previous backup still in flight']);
  assert.strictEqual(provider.runBackup(), active);
  let drained = false;
  const stopped = provider.shutdown().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.isFalse(drained);
  pending.resolve(created);
  await stopped;
  assert.deepEqual(events, ['source', 'directory', 'create', 'prune']);
  assert.isTrue(drained);
  assert.include(provider.messages, `backup written ${created.path}`);
  const messages = [...provider.messages];
  clock.tick(DAY_MS);
  await Promise.resolve();
  assert.deepEqual(provider.messages, messages);
  await assert.rejects(() => provider.runBackup(), /stopped/);
});

test('failed creates skip prune, later daily runs report warnings and retention failures', async (context) => {
  const { assert, cleanup } = context;
  const clock = useClock(context);
  const events: string[] = [];
  const backup = makeBackup(events);
  backup.create = async () => {
    events.push('create');
    throw Object.assign(new Error('copy unavailable'), {
      cleanupError: new Error('cleanup unavailable'),
    });
  };
  const provider = new LoggedProvider(makeApplication(backup));
  cleanup(() => provider.shutdown());
  await provider.ready();
  await assert.rejects(() => provider.runBackup(), /copy unavailable/);
  assert.deepEqual(events, ['source', 'directory', 'create']);
  assert.deepEqual(provider.messages, [
    'backup FAILED — Error: copy unavailable',
    'backup temp cleanup failed: Error: cleanup unavailable',
  ]);
  backup.create = async () => {
    events.push('create');
    return { ...created, warnings: ['journal warning'] };
  };
  for (const pruneFails of [false, true]) {
    backup.prune = () => {
      events.push('prune');
      if (pruneFails) throw new Error('retention unavailable');
      return {
        removed: [],
        abandoned: [],
        failed: [{ name: 'old', reason: 'permission refused' }],
      };
    };
    clock.tick(DAY_MS);
    const result = await provider.runBackup();
    assert.equal(result.path, created.path);
    assert.include(provider.messages, 'backup warning: journal warning');
    assert.include(
      provider.messages,
      pruneFails
        ? 'backup retention failed: Error: retention unavailable'
        : 'backup retention could not remove old: permission refused'
    );
  }
  assert.lengthOf(
    provider.messages.filter((message) => message.includes('backup FAILED')),
    1
  );
  assert.deepEqual(events, ['source', 'directory', 'create', 'create', 'prune', 'create', 'prune']);
});

test('the booted app resolves the package service and its recovery and create commands', async ({
  assert,
  test: t,
  cleanup,
}) => {
  t.timeout(60_000);
  assert.instanceOf(await app.container.make('sqlite.backup'), SqliteBackup);
  const fixture = operatorFixture();
  cleanup(() => fixture.cleanup());
  const empty = join(fixture.root, 'empty');
  prepareDirectory(empty);
  const listed = fixture.command(['db:backup', 'list', '--directory', empty]);
  assert.equal(listed.status, 0, listed.output);
  assert.equal(listed.stdout.trim(), '', listed.output);
  const initialized = fixture.command(['app:upgrade']);
  assert.equal(initialized.status, 0, initialized.output);
  const directory = join(fixture.root, 'manual');
  const command = fixture.command(['db:backup', 'create'], {
    CAPACITYLENS_BACKUP_DIR: directory,
  });
  assert.equal(command.status, 0, command.output);
  const bundles = listBundles(directory);
  assert.lengthOf(bundles, 1);
  assert.include(command.output, `Backup ${bundles[0]!.name} written to ${bundles[0]!.path}`);
  assert.equal(verifyBundle(directory, bundles[0]!.name).path, bundles[0]!.path);
});
