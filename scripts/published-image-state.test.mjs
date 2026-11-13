import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./published-image-state.sh', import.meta.url));

/**
 * Runs the script against a fake `docker` whose nth call gives the nth answer (the last repeats).
 *
 * @param {Array<{ stderr?: string, status: number }>} answers
 * @param {Record<string, string>} [env]
 */
function run(answers, env = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'capacitylens-image-state-'));
  try {
    const cases = answers
      .map(({ stderr = '', status }, index) => {
        const call = index === answers.length - 1 ? '*' : String(index + 1);
        return `  ${call}) printf '%s\\n' ${JSON.stringify(stderr)} >&2; exit ${status} ;;`;
      })
      .join('\n');
    writeFileSync(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
count=$(( $(cat "${bin}/count" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "${bin}/count"
case "$count" in
${cases}
esac
`,
      { mode: 0o755 }
    );
    return spawnSync(script, ['ghcr.io/kevinjohn/capacitylens-api:1.2.3'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FIRST_PUBLICATION: '',
        PATH: `${bin}:${process.env.PATH}`,
        PUBLISHED_IMAGE_STATE_RETRY_SECONDS: '0',
        ...env,
      },
    });
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

test('a published image is present', () => {
  const result = run([{ status: 0 }]);
  assert.equal(result.stdout, 'present\n');
  assert.equal(result.status, 0);
});

for (const stderr of ['manifest unknown', 'No such manifest: x']) {
  test(`a registry answer of "${stderr}" means the image is absent`, () => {
    const result = run([{ stderr, status: 1 }]);
    assert.equal(result.stdout, 'absent\n');
    assert.equal(result.status, 0);
  });
}

test('a denied answer stops the job outside the first publication', () => {
  const result = run([{ stderr: 'denied', status: 1 }]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /::error::Could not tell/);
});

test('a denied answer means absent for the first publication', () => {
  const result = run([{ stderr: 'denied', status: 1 }], { FIRST_PUBLICATION: 'true' });
  assert.equal(result.stdout, 'absent\n');
  assert.equal(result.status, 0);
});

test('a passing registry error is retried once', () => {
  const result = run([{ stderr: 'unauthorized', status: 1 }, { status: 0 }]);
  assert.equal(result.stdout, 'present\n');
  assert.equal(result.status, 0);
});
