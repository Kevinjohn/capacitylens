import { cpSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
// @ts-expect-error better-sqlite3 does not publish declarations
import Database from 'better-sqlite3';
import { listBundles, verifyBundle } from '@kevinjohn/adonisjs-sqlite-backup';
import { scratchBackendFilter } from '#tests/helpers/operator_command_helpers';

export const appRoot = process.cwd();
/** How many migrations this build ships; a scratch app adds its own after them. */
export const shipped = readdirSync(join(appRoot, 'database/migrations')).filter((name) =>
  name.endsWith('.ts')
).length;

export function command(root: string, databasePath: string, args: string[], backupDir?: string) {
  const web = args.includes('bin/server.ts');
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: web ? 8_000 : 25_000,
    env: {
      ...process.env,
      CAPACITYLENS_DB: databasePath,
      CAPACITYLENS_BACKUP_DIR: backupDir ?? '',
      APP_KEY: 'capacitylens-test-key-0123456789abcdef',
      APP_URL: 'http://127.0.0.1',
      HOST: '127.0.0.1',
      PORT: '0',
      LOG_LEVEL: 'info',
      NODE_ENV: web ? 'production' : 'test',
      CAPACITYLENS_ALLOW_RESET: 'false',
      CAPACITYLENS_CREATE_ADMIN_ADMIN: 'false',
      CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: '',
      CAPACITYLENS_PUBLIC_URL: 'http://127.0.0.1',
    },
  });
  if (child.error) throw child.error;
  return {
    status: child.status,
    stderr: child.stderr,
    output: `${child.stdout}\n${child.stderr}`,
  };
}

export const ace = (root: string, databasePath: string, name: string, backupDir?: string) =>
  command(root, databasePath, ['ace.js', name], backupDir);

export function journal(databasePath: string) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return database.prepare('SELECT name FROM adonis_schema ORDER BY id').all() as Array<{
      name: string;
    }>;
  } finally {
    database.close();
  }
}

export function tables(databasePath: string) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    return (
      database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map(({ name }) => name);
  } finally {
    database.close();
  }
}

/** Copy the backend so a test can add pending migrations after the baseline. */
export function scratchApp(root: string, migrations: Record<string, string>) {
  const scratch = join(root, 'backend');
  cpSync(appRoot, scratch, { recursive: true, filter: scratchBackendFilter });
  symlinkSync(join(appRoot, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  for (const [name, source] of Object.entries(migrations))
    writeFileSync(join(scratch, `database/migrations/${name}.ts`), source);
  return scratch;
}

export function preMigrationBackups(dir: string) {
  return listBundles(dir).map((bundle) => verifyBundle(dir, bundle.name).name);
}
