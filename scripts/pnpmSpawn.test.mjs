import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('synchronous spawn results follow Node encoding-dependent types', async (context) => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'capacitylens-spawn-types-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = join(directory, 'fixture.mts');
  await writeFile(
    fixture,
    `import { spawnPnpmSync } from ${JSON.stringify(join(root, 'scripts/pnpmSpawn.mjs'))};
import type { SpawnSyncOptions } from "node:child_process";
const binary: Buffer | null = spawnPnpmSync([]).stdout;
const binaryExplicit: Buffer | null = spawnPnpmSync([], {encoding: "buffer"}).stdout;
const text: string | null = spawnPnpmSync([], {encoding: "utf8"}).stdout;
const textError: string | null = spawnPnpmSync([], {encoding: "utf8"}).stderr;
const options: SpawnSyncOptions = {};
const either: Buffer | string | null = spawnPnpmSync([], options).stdout;
function run(options?: SpawnSyncOptions) { return spawnPnpmSync([], options); }
const optional: Buffer | string | null = run().stdout;
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--target',
      'ES2022',
      '--types',
      'node',
      '--typeRoots',
      join(root, 'node_modules/@types'),
      fixture,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
