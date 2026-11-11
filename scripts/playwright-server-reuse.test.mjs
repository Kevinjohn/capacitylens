import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configSource = await readFile(new URL('../playwright.config.ts', import.meta.url), 'utf8');
const viteConfigSource = await readFile(
  new URL('../apps/frontend/vite.config.ts', import.meta.url),
  'utf8',
);
const workerRuntimeSource = await readFile(
  new URL('./e2eWorkerRuntime.mjs', import.meta.url),
  'utf8',
);

test('every automatically started Playwright server refuses an existing endpoint', () => {
  const reuseSettings = [...configSource.matchAll(/reuseExistingServer:\s*([^,\n]+)/g)].map(
    (match) => match[1].trim(),
  );

  assert.equal(
    reuseSettings.length,
    2,
    'expected the two auth-profile global servers to declare their reuse policy',
  );
  assert.deepEqual(
    reuseSettings,
    Array.from({ length: 2 }, () => 'false'),
  );
});

test('the standard profile waits for real database readiness through both Vite proxies', () => {
  const probes = [
    ...configSource.matchAll(
      /url:\s*`http:\/\/127\.0\.0\.1:\$\{lanePorts\.(authApi|authWeb)\}([^`]*)`/g,
    ),
  ].map((match) => `${match[1]}${match[2]}`);

  assert.deepEqual(probes, ['authApi/health/ready', 'authWeb/health/ready']);
  assert.match(
    viteConfigSource,
    /'\/health':\s*{[\s\S]*?target: `http:\/\/localhost:\$\{devApiPort\}`/,
  );
});

test('worker startup waits for API readiness before Vite proxy readiness', () => {
  const apiProbe = workerRuntimeSource.indexOf(
    "await waitReady(api, `${target.api}/health/ready`, 'E2E API server');",
  );
  const webProbe = workerRuntimeSource.indexOf(
    "await waitReady(vite, `${target.web}/health/ready`, 'E2E Vite proxy', processes);",
  );

  assert.ok(apiProbe >= 0, 'expected the worker API readiness probe');
  assert.ok(webProbe > apiProbe, 'expected the Vite proxy probe after API readiness');
});
