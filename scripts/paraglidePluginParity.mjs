import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnPnpmSync } from './pnpmSpawn.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = join(root, 'apps/frontend');
const generated = join(frontend, 'src/paraglide');
const temp = await mkdtemp(join(tmpdir(), 'capacitylens-paraglide-parity-'));
const { createServer } = await import(
  pathToFileURL(join(frontend, 'node_modules/vite/dist/node/index.js')).href
);

async function treeDigest(directory) {
  const entries = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const absolute = join(path, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        entries.push([
          relative(directory, absolute).replaceAll('\\', '/'),
          createHash('sha256').update(bytes).digest('hex'),
        ]);
      }
    }
  }
  await visit(directory);
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

try {
  const cli = spawnPnpmSync(
    [
      '--dir',
      'apps/frontend',
      'exec',
      'paraglide-js',
      'compile',
      '--project',
      './project.inlang',
      '--outdir',
      temp,
      '--strategy',
      'globalVariable',
      'baseLocale',
      '--output-structure',
      'locale-modules',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (cli.error) throw cli.error;
  if (cli.status !== 0)
    throw new Error(`Paraglide CLI parity compile failed:\n${cli.stderr || cli.stdout}`);

  const vite = await createServer({
    configFile: join(frontend, 'vite.config.ts'),
    root: frontend,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'silent',
  });
  await vite.close();
  assert.deepEqual(
    await treeDigest(generated),
    await treeDigest(temp),
    'Paraglide Vite plugin and CLI must generate identical modules before the plugin is disabled for worker servers',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
