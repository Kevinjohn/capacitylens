// Preloaded into the benchmarked server with --require. Counts better-sqlite3 statement
// executions; SIGUSR2 writes the running total to BENCH_SQL_COUNT_FILE.
const { createRequire } = require('node:module');
const { writeFileSync } = require('node:fs');
// A preload that cannot wrap the driver leaves the server running and the count unavailable;
// the SIGUSR2 handler stays installed so the signal never terminates the server.
let count = null;
try {
  const Database = createRequire(process.env.BENCH_BACKEND + '/package.json')('better-sqlite3');
  const statement = Object.getPrototypeOf(new Database(':memory:').prepare('select 1'));
  for (const name of ['run', 'get', 'all', 'iterate']) {
    const original = statement[name];
    statement[name] = function (...args) {
      count += 1;
      return original.apply(this, args);
    };
  }
  const exec = Database.prototype.exec;
  Database.prototype.exec = function (...args) {
    count += 1;
    return exec.apply(this, args);
  };
  count = 0;
} catch (error) {
  console.error('[bench] SQL counter unavailable:', error.message);
}
process.on('SIGUSR2', () => {
  if (count !== null) writeFileSync(process.env.BENCH_SQL_COUNT_FILE, String(count));
});
