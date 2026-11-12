import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildFaq } from './build-faq.mjs';

const names = [
  '01-access-and-getting-around',
  '02-read-the-plan',
  '03-people-and-work',
  '04-bookings-and-time-off',
  '05-company-data-and-privacy',
];

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'documentation-faq-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'documentation-exploration');
  await mkdir(join(root, 'faq-parts'), { recursive: true });
  await mkdir(join(base, 'user-stories'));
  const stories = names.map((_, i) => ({
    id: `US-TEST-0${i + 1}`,
    path: `US-TEST-0${i + 1}.md`,
    status: i === 1 ? 'Hidden — no current control.' : 'Current',
  }));
  await writeFile(
    join(root, 'faq-catalogue.json'),
    JSON.stringify({
      sourceCommit: 'example-revision',
      sourcePullRequest: 'https://example.com/catalogue',
      sourceState: 'example',
      stories,
    }),
  );
  for (const [i, name] of names.entries()) {
    const anchor = `faq-example-${i + 1}`;
    await writeFile(
      join(root, 'faq-parts', `${name}.md`),
      `## Topic ${i + 1}\n\n<span id="${anchor}"></span>\n\n### Can I use option ${i + 1}?\n\n${i === 1 ? 'This control is unavailable.' : 'Open the matching page.'}\n`,
    );
    await writeFile(
      join(root, 'faq-parts', `${name}.json`),
      JSON.stringify([{ story: stories[i].id, question: anchor }]),
    );
    await writeFile(join(base, 'user-stories', stories[i].path), `# ${stories[i].id} — Example\n`);
  }
  return {
    root,
    base,
    part: (i, extension) => join(root, 'faq-parts', `${names[i]}.${extension}`),
  };
}

test('assembles every mapped story and preserves unavailable status in maintainer coverage', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await buildFaq(f.root), { stories: 5, questions: 5 });
  const faq = await readFile(join(f.root, 'faq.md'), 'utf8');
  const coverage = await readFile(join(f.root, 'faq-coverage.md'), 'utf8');
  assert.match(faq, /This control is unavailable\./);
  assert.doesNotMatch(faq, /US-TEST/);
  assert.match(coverage, /5 of 5 stories/);
  assert.match(coverage, /Hidden — no current control/);
  assert.match(coverage, /faq\.md#faq-example-2/);
});

test('refuses a story without an answer', async (t) => {
  const f = await fixture(t);
  await writeFile(f.part(4, 'json'), '[]');
  await assert.rejects(buildFaq(f.root), /Stories without an FAQ answer: US-TEST-05/);
});

test('refuses duplicate story mappings rather than counting them as coverage', async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.part(1, 'json'),
    JSON.stringify([{ story: 'US-TEST-01', question: 'faq-example-2' }]),
  );
  await assert.rejects(buildFaq(f.root), /Duplicate FAQ mapping: US-TEST-01/);
});

test('refuses a mapping to a missing question', async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.part(1, 'json'),
    JSON.stringify([{ story: 'US-TEST-02', question: 'faq-missing' }]),
  );
  await assert.rejects(buildFaq(f.root), /FAQ mapping points outside its part/);
});

test('refuses duplicate anchors and untracked questions', async (t) => {
  const f = await fixture(t);
  const second = await readFile(f.part(1, 'md'), 'utf8');
  await writeFile(f.part(1, 'md'), second.replaceAll('faq-example-2', 'faq-example-1'));
  await assert.rejects(buildFaq(f.root), /Duplicate FAQ anchor: faq-example-1/);
  await writeFile(
    f.part(1, 'md'),
    `${second}\n<span id="faq-extra"></span>\n\n### Is there another option?\n\nExtra answer.\n`,
  );
  await assert.rejects(buildFaq(f.root), /Unmapped FAQ question: faq-extra/);
});

test('requires a catalogue refresh when the local stories gain a new identifier', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.base, 'user-stories', 'US-TEST-06.md'), '# US-TEST-06 — New capability\n');
  await assert.rejects(buildFaq(f.root), /Refresh the FAQ catalogue for local story US-TEST-06/);
});

test('keeps installation at the end of the reader appendix', async (t) => {
  const f = await fixture(t);
  const cataloguePath = join(f.root, 'faq-catalogue.json');
  const catalogue = JSON.parse(await readFile(cataloguePath, 'utf8'));
  catalogue.stories.push({ id: 'US-TEST-06', path: 'US-TEST-06.md', status: 'Operator' });
  await writeFile(cataloguePath, JSON.stringify(catalogue));
  await writeFile(join(f.base, 'user-stories', 'US-TEST-06.md'), '# US-TEST-06 — Service\n');
  const body = await readFile(f.part(0, 'md'), 'utf8');
  await writeFile(
    f.part(0, 'md'),
    `${body}\n## Installation and service\n\n<span id="faq-service"></span>\n\n### Who runs the service?\n\nAsk the operator.\n`,
  );
  const mapping = JSON.parse(await readFile(f.part(0, 'json'), 'utf8'));
  mapping.push({ story: 'US-TEST-06', question: 'faq-service' });
  await writeFile(f.part(0, 'json'), JSON.stringify(mapping));
  await buildFaq(f.root);
  const faq = await readFile(join(f.root, 'faq.md'), 'utf8');
  const headings = [...faq.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.equal(headings.at(-1), 'Installation and service');
  assert.ok(faq.indexOf('### Who runs the service?') > faq.indexOf('## Topic 5'));
});

test('links several useful answers for one story without duplicating the story count', async (t) => {
  const f = await fixture(t);
  const body = await readFile(f.part(0, 'md'), 'utf8');
  await writeFile(
    f.part(0, 'md'),
    `${body}\n<span id="faq-example-extra"></span>\n\n### How do the amount fields work?\n\nUse the fields for the current mode.\n`,
  );
  await writeFile(
    f.part(0, 'json'),
    JSON.stringify([
      { story: 'US-TEST-01', question: 'faq-example-1', relatedQuestions: ['faq-example-extra'] },
    ]),
  );
  assert.deepEqual(await buildFaq(f.root), { stories: 5, questions: 6 });
  const coverage = await readFile(join(f.root, 'faq-coverage.md'), 'utf8');
  assert.match(coverage, /faq\.md#faq-example-1/);
  assert.match(coverage, /faq\.md#faq-example-extra/);
});
