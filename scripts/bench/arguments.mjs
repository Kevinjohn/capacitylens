import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';

/** Parse the benchmark's command line; the backend defaults to `production/backend`. */
export function parseArguments(argv, repositoryRoot) {
  const options = { samples: 200, warmup: 20, fixtures: ['seed', 'large'], backend: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--samples') options.samples = Number(argv[++index]);
    else if (argument === '--warmup') options.warmup = Number(argv[++index]);
    else if (argument === '--fixtures') options.fixtures = String(argv[++index]).split(',');
    else if (argument.startsWith('--')) throw new Error(`Unknown option ${argument}`);
    else options.backend = argument;
  }
  assert.ok(Number.isInteger(options.samples) && options.samples > 0, '--samples must be positive');
  assert.ok(Number.isInteger(options.warmup) && options.warmup >= 0, '--warmup must be >= 0');
  for (const name of options.fixtures)
    assert.ok(['seed', 'large'].includes(name), `Unknown fixture ${name}`);
  options.backend = resolve(options.backend ?? join(repositoryRoot, 'production', 'backend'));
  return options;
}
