import { spawn } from 'node:child_process';
import { once } from 'node:events';

/**
 * From another process, as a concurrent writer would, takes SQLite's write lock, holds it for
 * `holdMs` and then commits `statements`. It resolves once the lock is held; await the returned
 * promise for the commit. The holder releases on its own clock because the app's synchronous driver
 * blocks this process while it waits, and a second SQLite copy in this process would not see this
 * process's file locks.
 */
export async function commitUnderWriteLock(
  statements: Array<[sql: string, ...params: string[]]>,
  holdMs = 300
) {
  const holder = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { DatabaseSync } from 'node:sqlite'
const [file, holdMs, statements] = process.argv.slice(1)
const db = new DatabaseSync(file)
db.exec('PRAGMA foreign_keys = ON')
db.exec('BEGIN IMMEDIATE')
console.log('locked')
setTimeout(() => {
  for (const [sql, ...params] of JSON.parse(statements)) db.prepare(sql).run(...params)
  db.exec('COMMIT')
  db.close()
}, Number(holdMs))`,
      process.env.CAPACITYLENS_DB!,
      String(holdMs),
      JSON.stringify(statements),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  await once(holder.stdout!, 'data');
  return once(holder, 'exit').then(([code]) => {
    if (code !== 0) throw new Error(`The write-lock holder exited with ${code}.`);
  });
}
