import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('frontend checks wait for the backend build their route types come from', () => {
  // The frontend links the backend with link:, which turbo does not count as a workspace
  // dependency, so turbo.json must name the edge or a cached frontend result survives backend edits.
  const plan = JSON.parse(
    execFileSync('pnpm', ['exec', 'turbo', 'run', 'typecheck', 'lint', 'test', '--dry=json'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
    }),
  );
  for (const task of ['typecheck', 'lint', 'test']) {
    const entry = plan.tasks.find(({ taskId }) => taskId === `@capacitylens/frontend#${task}`);
    assert.ok(entry, `frontend ${task} is planned`);
    assert.ok(
      entry.dependencies.includes('@capacitylens/backend#build'),
      `frontend ${task} depends on the backend build`,
    );
  }
});
