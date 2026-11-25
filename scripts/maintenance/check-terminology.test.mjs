import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findInText, findViolations, isExempt } from './check-terminology.mjs';

const script = fileURLToPath(new URL('./check-terminology.mjs', import.meta.url));
const rejectedIn = (text) => findInText(text).map((hit) => hit.rejected);

test('a rejected word matches inside identifiers of every casing', () => {
  for (const text of [
    'routeGuards',
    'RouteGuard',
    'route_guards.ts',
    'route-guard',
    'ROUTE_GUARD',
    'Route guard',
  ])
    assert.deepEqual(rejectedIn(text), ['route guard'], text);
  assert.deepEqual(rejectedIn('const tenantId = 1'), ['tenant']);
  assert.deepEqual(rejectedIn('Tenants are companies'), ['tenant']);
});

test('a phrase also matches across a line break but not across punctuation or a blank line', () => {
  assert.deepEqual(rejectedIn('the route\nguard'), ['route guard']);
  assert.deepEqual(rejectedIn('route. guard'), []);
  assert.deepEqual(rejectedIn('route\n\nguard'), []);
  assert.deepEqual(rejectedIn('const company = document.data'), []);
});

test('a word that only contains a rejected one does not match', () => {
  for (const text of ['tenantless', 'catalogue', 'utilisation', 'dialogs', 'modalities', 'signUp'])
    assert.deepEqual(rejectedIn(text), [], text);
});

test('a phrase on the allow-list hides the rejected word it contains and nothing else', () => {
  assert.deepEqual(rejectedIn('<div aria-modal="true">'), []);
  assert.deepEqual(rejectedIn('ariaModal'), []);
  assert.deepEqual(rejectedIn('isAccountCommandId'), []);
  assert.deepEqual(rejectedIn('aria-modal and a modal'), ['modal']);
});

test('violations name the file, the line, the word and the ruling', () => {
  const read = () => 'fine\nconst workspaceId = utilization;\n';
  assert.deepEqual(findViolations(['apps/frontend/src/a.ts'], read), [
    'apps/frontend/src/a.ts:2: "workspace id"; say "company id" (code_convention_terminology.md)',
    'apps/frontend/src/a.ts:2: "utilization"; say "utilisation" (code_convention_terminology.md)',
  ]);
});

test('a file name is checked even when the file is not text', () => {
  const messages = findViolations(['docs-src/screenshots/resource_modal.png'], () => {
    throw new Error('a png is never read');
  });
  assert.equal(messages.length, 1);
  assert.match(messages[0], /file name says "modal"/);
});

test('text is read under source, documentation, story and message paths and in root Markdown only', () => {
  const read = () => 'a tenant\n';
  for (const path of [
    'apps/frontend/messages/en.json',
    'user-stories/a/US-1.md',
    'docs-src/a.md',
    'README.md',
    'scripts/a.mjs',
    'e2e/a.spec.ts',
  ])
    assert.equal(findViolations([path], read).length, 1, path);
  for (const path of ['.github/workflows/a.yml', 'packaging/a.json', 'Dockerfile', 'nginx.conf'])
    assert.deepEqual(findViolations([path], read), [], path);
});

test('exempt paths and per-file allowances are skipped as data', () => {
  const read = () => 'a tenant and a signup\n';
  for (const path of [
    'code_convention_terminology.md',
    'apps/frontend/src/components/ui/button.tsx',
    'apps/backend/.adonisjs/client/a.d.ts',
    'pnpm-lock.yaml',
  ]) {
    assert.ok(isExempt(path), path);
    assert.deepEqual(findViolations([path], read), [], path);
  }
  assert.equal(findViolations(['docs-src/reference/adonisjs-conventions.md'], read).length, 1);
});

test('the whole tracked tree passes', () => {
  const output = execFileSync(process.execPath, [script], { encoding: 'utf8' });
  assert.match(output, /no rejected synonyms/);
});

test('a rejected synonym makes the command exit 1 and print the ruling', () => {
  const directory = mkdtempSync(join(tmpdir(), 'terminology-'));
  const path = join(directory, 'signup.md');
  writeFileSync(path, 'text\n');
  try {
    const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /file name says "signup"; say "sign up"/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
