import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { resolvePortLane, workerPorts } from '../tooling/ports.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestResetControl } from '../tooling/e2e_reset_control.ts';

const backendDirectory = fileURLToPath(new URL('../apps/backend/', import.meta.url));

/** All endpoints and files belonging to one stable browser-worker slot. */
export interface ServerTarget {
  portLane: number;
  slot: number;
  api: string;
  databasePath: string;
  templatePath: string;
}

/** Resolve isolated browser-worker endpoints and disposable database paths. */
export function serverTarget(portLane: number, slot: number): ServerTarget {
  const endpoints = workerPorts(portLane, slot);
  const databasePath = resolve(backendDirectory, `.e2e-l${portLane}-w${slot}.db`);
  return Object.freeze({
    portLane,
    slot,
    api: `http://localhost:${endpoints.api}`,
    databasePath,
    templatePath: `${databasePath}.template`,
  });
}

let configuredTarget = serverTarget(resolvePortLane(), 0);
let resetControlToken: string | undefined;
let stopOwnedServer: (() => Promise<void>) | undefined;
/** Current worker API origin; imports observe configuration before a test starts. */
export let API = configuredTarget.api;

/** Bind this Playwright worker to its owned target and request-drain boundary. */
export function configureServerTarget(
  target: ServerTarget,
  control: { controlToken: string; stop: () => Promise<void> },
) {
  configuredTarget = target;
  API = target.api;
  resetControlToken = control.controlToken;
  stopOwnedServer = control.stop;
}

const resetControlTimeoutMs = 5_000;

async function resumeApi(token: string, primary: unknown): Promise<never | void> {
  const errors: unknown[] = [];
  try {
    await requestResetControl(token, 'api', 'resume', resetControlTimeoutMs);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) {
    let stopError: unknown;
    try {
      await stopOwnedServer?.();
    } catch (error) {
      stopError = error;
    }
    throw new AggregateError(
      [primary, ...errors, ...(stopError ? [stopError] : [])],
      'Reset failed and the owned worker API could not be safely resumed; it was stopped.',
      { cause: primary },
    );
  }
}

async function withDataListenersPaused<T>(target: ServerTarget, restore: () => T): Promise<T> {
  if (target !== configuredTarget)
    throw new Error('A reset must use this worker’s configured target.');
  if (!resetControlToken || !stopOwnedServer)
    throw new Error('The worker reset control boundary is not configured.');

  const token = resetControlToken;
  let result: T;
  try {
    await requestResetControl(token, 'api', 'pause', resetControlTimeoutMs);
    result = restore();
  } catch (error) {
    await resumeApi(token, error);
    throw error;
  }

  try {
    await requestResetControl(token, 'api', 'resume', resetControlTimeoutMs);
  } catch (error) {
    let stopError: unknown;
    try {
      await stopOwnedServer();
    } catch (cleanupError) {
      stopError = cleanupError;
    }
    throw new AggregateError(
      [error, ...(stopError ? [stopError] : [])],
      'Reset completed but the owned worker API could not resume; it was stopped.',
      { cause: error },
    );
  }
  return result;
}

function assertDisposableDatabase(target: ServerTarget) {
  if (
    !/^\.e2e-l\d-w\d{1,2}\.db$/.test(basename(target.databasePath)) ||
    resolve(target.databasePath, '..') !== resolve(backendDirectory) ||
    !existsSync(target.databasePath) ||
    realpathSync(target.databasePath) !== resolve(target.databasePath)
  )
    throw new Error('The disposable database-backed fixture is unavailable.');
}

/** Verify the server bootstrapped its fixture identity; company resets never recreate credentials. */
export function ensureDbTestAdmin(target: ServerTarget = configuredTarget) {
  assertDisposableDatabase(target);
  const db = new DatabaseSync(target.databasePath, { readOnly: true });
  let found: boolean;
  try {
    found = Boolean(db.prepare('SELECT id FROM users WHERE email = ?').get('admin@admin.admin'));
  } finally {
    db.close();
  }
  if (!found)
    throw new Error('The disposable administrator is unavailable; restart the worker fixture.');
}

const companyTables = [
  'companies',
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'time_off',
  'closures',
  'memberships',
  'audit_entries',
  'company_planning_revisions',
  'planning_mutations',
  'deleted_groups',
  'deleted_rows',
  'account_member_resources',
  'company_settings',
  'company_getting_started_dismissals',
  'request_receipts',
  'password_confirmations',
] as const;

function orderedCompanyTables(db: DatabaseSync): string[] {
  const remaining = new Set<string>(companyTables);
  const ordered: string[] = [];
  while (remaining.size) {
    const next = [...remaining].find((table) => {
      const dependencies = db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
        table: string;
      }>;
      return dependencies.every(
        (dependency) => dependency.table === table || !remaining.has(dependency.table),
      );
    });
    if (!next) throw new Error('Disposable company tables contain a foreign-key cycle.');
    const columns = db.prepare(`PRAGMA table_info("${next}")`).all();
    if (!columns.length) throw new Error(`The disposable schema is missing ${next}.`);
    ordered.push(next);
    remaining.delete(next);
  }
  return ordered;
}

function bindFixtureOwner(db: DatabaseSync) {
  const administrator = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('admin@admin.admin') as { id: string } | undefined;
  if (!administrator) throw new Error('The disposable administrator is unavailable.');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memberships (scope_id, user_id, role, status, created_at, updated_at)
    VALUES ('a-studio', ?, 'owner', 'active', ?, ?)`,
  ).run(administrator.id, now, now);
}

/** Snapshot the worker's initial company once; identities are never restored from this template. */
export async function prepareServerTemplate(target: ServerTarget): Promise<void> {
  await withDataListenersPaused(target, () => {
    ensureDbTestAdmin(target);
    const db = new DatabaseSync(target.databasePath);
    try {
      orderedCompanyTables(db);
      db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
      try {
        db.exec(
          "DELETE FROM audit_entries; DELETE FROM memberships; DELETE FROM companies WHERE id <> 'a-studio'",
        );
        bindFixtureOwner(db);
        db.exec(
          "INSERT OR IGNORE INTO company_planning_revisions (company_id, revision) VALUES ('a-studio', 0)",
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      rmSync(target.templatePath, { force: true });
      db.prepare('VACUUM INTO ?').run(target.templatePath);
    } finally {
      db.close();
    }
  });
}

type ResetServerOptions = {
  withSeed?: boolean;
  target?: ServerTarget;
};

/** Restore only company-owned tables through SQLite; users, sessions and Account Kit records survive. */
export async function resetServer({
  withSeed = true,
  target = configuredTarget,
}: ResetServerOptions): Promise<void> {
  await withDataListenersPaused(target, () => {
    ensureDbTestAdmin(target);
    if (
      !existsSync(target.templatePath) ||
      realpathSync(target.templatePath) !== resolve(target.templatePath)
    )
      throw new Error('The disposable company template is unavailable.');
    const db = new DatabaseSync(target.databasePath);
    try {
      db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
      const tables = orderedCompanyTables(db);
      db.prepare('ATTACH DATABASE ? AS fixture_template').run(target.templatePath);
      try {
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const table of tables.toReversed()) db.exec(`DELETE FROM "${table}"`);
          if (withSeed) {
            for (const table of tables) {
              if (table === 'memberships') bindFixtureOwner(db);
              else db.exec(`INSERT INTO "${table}" SELECT * FROM fixture_template."${table}"`);
            }
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } finally {
        db.exec('DETACH DATABASE fixture_template');
      }
    } finally {
      db.close();
    }
  });
}

/** Read the real worker's company state for persistence assertions. */
export async function serverState(
  request: APIRequestContext,
  target: ServerTarget = configuredTarget,
): Promise<
  Record<
    string,
    Array<{
      id: string;
      name?: string;
      archivedAt?: string;
      language?: string;
      seriesId?: string;
      engagement?: 'studio' | 'supplementary';
      halfDays?: number[];
      avatarUrl?: string;
    }>
  >
> {
  const response = await request.get(
    `${target.api}/api/state?companyId=a-studio&includeInactive=1`,
    {
      maxRetries: 1,
    },
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}
/** Returns the named table’s rows without changing the server state.
 * @throws Error when the response omits the table; callers must not treat an omitted table as empty.
 */
export function requireStateRows<T extends Awaited<ReturnType<typeof serverState>>>(
  state: T,
  table: keyof T,
): T[keyof T] {
  const rows = state[table];
  if (rows === undefined) throw new Error(`Server state must include the ${String(table)} table`);
  return rows;
}
