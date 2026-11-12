import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format } from 'prettier';

const parts = [
  '01-access-and-getting-around',
  '02-read-the-plan',
  '03-people-and-work',
  '04-bookings-and-time-off',
  '05-company-data-and-privacy',
];

async function localStoryIds(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return localStoryIds(path);
      if (!/^US-.*\.md$/.test(entry.name)) return [];
      const body = await readFile(path, 'utf8');
      const id = body.match(/^# (US-[A-Z]+-\d+)\b/m)?.[1];
      if (!id) throw new Error(`Story has no identifier: ${path}`);
      return [id];
    }),
  );
  return groups.flat();
}

/** Assembles reader answers and verifies their coverage against the pinned story catalogue. */
export async function buildFaq(root, formatOptions) {
  const catalogue = JSON.parse(await readFile(resolve(root, 'faq-catalogue.json'), 'utf8'));
  const stories = new Map(catalogue.stories.map((story) => [story.id, story]));
  if (!stories.size || stories.size !== catalogue.stories.length) {
    throw new Error('FAQ catalogue must contain unique story identifiers.');
  }
  const localIds = await localStoryIds(resolve(root, '../user-stories'));
  for (const id of localIds) {
    if (!stories.has(id)) throw new Error(`Refresh the FAQ catalogue for local story ${id}.`);
  }
  const sources = await Promise.all(
    parts.map(async (part) => ({
      part,
      body: await readFile(resolve(root, 'faq-parts', `${part}.md`), 'utf8'),
      mappings: JSON.parse(await readFile(resolve(root, 'faq-parts', `${part}.json`), 'utf8')),
    })),
  );
  const anchors = new Set();
  const questions = new Map();
  const mappings = new Map();
  for (const source of sources) {
    if (/^# /m.test(source.body))
      throw new Error(`FAQ part cannot introduce an H1: ${source.part}`);
    const entries = [...source.body.matchAll(/<span id="(faq-[a-z0-9-]+)"><\/span>\s*\n### (.+)/g)];
    const headingCount = [...source.body.matchAll(/^### /gm)].length;
    if (!entries.length || entries.length !== headingCount) {
      throw new Error(`Every FAQ question needs one explicit stable anchor: ${source.part}`);
    }
    for (const [, anchor, question] of entries) {
      if (anchors.has(anchor)) throw new Error(`Duplicate FAQ anchor: ${anchor}`);
      if (!question.trim().endsWith('?'))
        throw new Error(`FAQ heading is not a question: ${question}`);
      anchors.add(anchor);
      questions.set(anchor, question.trim());
    }
    const ownedAnchors = new Set(entries.map((entry) => entry[1]));
    for (const mapping of source.mappings) {
      if (!stories.has(mapping.story)) throw new Error(`Unknown FAQ story: ${mapping.story}`);
      if (mappings.has(mapping.story)) throw new Error(`Duplicate FAQ mapping: ${mapping.story}`);
      const destinations = [mapping.question, ...(mapping.relatedQuestions ?? [])];
      for (const destination of destinations) {
        if (!ownedAnchors.has(destination)) {
          throw new Error(`FAQ mapping points outside its part: ${mapping.story} → ${destination}`);
        }
      }
      mappings.set(mapping.story, destinations);
    }
  }
  const missing = [...stories.keys()].filter((id) => !mappings.has(id));
  if (missing.length) throw new Error(`Stories without an FAQ answer: ${missing.join(', ')}`);
  for (const anchor of anchors) {
    if (![...mappings.values()].flat().includes(anchor))
      throw new Error(`Unmapped FAQ question: ${anchor}`);
  }
  const bodies = sources.map((source) =>
    source.body.trim().replace(/\]\(\.\.\/\.\.\/docs\//g, '](../docs/'),
  );
  const operatorSection = bodies[0].indexOf('\n## Installation and service\n');
  if (operatorSection >= 0) {
    const operatorBody = bodies[0].slice(operatorSection).trim();
    bodies[0] = bodies[0].slice(0, operatorSection).trim();
    bodies.push(operatorBody);
  }
  const body = bodies.join('\n\n');
  const titles = [...body.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  const slug = (title) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
  const contents = titles.map((title) => `- [${title}](#${slug(title)})`).join('\n');
  const introduction =
    '# FAQ appendix\n\nFind a specific answer about planning, people, bookings or access. You can use the main guide without reading this appendix.\n\nChoose a topic below, or use your browser’s Find command to search this page. Answers describe the controls available now; where a feature is unavailable, the answer says so.\n\n' +
    contents;
  await writeFile(
    resolve(root, 'faq.md'),
    await format(`${introduction}\n\n${body}\n`, { ...formatOptions, parser: 'markdown' }),
  );
  const table = catalogue.stories
    .map((story) => {
      const destinations = mappings.get(story.id);
      const source = `https://github.com/Kevinjohn/capacitylens/blob/${catalogue.sourceCommit}/user-stories/${story.path}`;
      return `| [${story.id}](${source}) | ${story.status.replaceAll('|', '\\|')} | ${destinations.map((anchor) => `[${questions.get(anchor).replaceAll('|', '\\|')}](faq.md#${anchor})`).join('<br>')} |`;
    })
    .join('\n');
  const coverage = `# FAQ story coverage\n\nMaintainer reference: **${mappings.size} of ${stories.size} stories** map to **${questions.size} reader questions**. Coverage means a linked answer represents each capability; it is not a claim that every acceptance criterion was exercised or that every feature is currently available.\n\nThe source is the expanded catalogue in [PR #1848](${catalogue.sourcePullRequest}), pinned at \`${catalogue.sourceCommit}\` (${catalogue.sourceState}). This exploration’s original checkout has ${localIds.length} story files. The proposal’s additional stories are used as coverage prompts, not as permission to change the product or advertise unavailable controls.\n\nHidden, conditional and demo-only behaviour stays explicit in the answers. The builder refuses missing stories, duplicate mappings and missing question anchors. If the local catalogue gains an identifier absent from the snapshot, the build requires a catalogue refresh. Matching counts alone do not prove the answers are accurate; the content still needs source review.\n\n[Read the FAQ appendix](faq.md). Editorial source parts and mappings are in \`faq-parts/\`; update those and regenerate rather than editing the assembled appendix.\n\n| Story | Catalogue availability | Reader question |\n| --- | --- | --- |\n${table}\n`;
  await writeFile(
    resolve(root, 'faq-coverage.md'),
    await format(coverage, { ...formatOptions, parser: 'markdown' }),
  );
  return { stories: stories.size, questions: questions.size };
}
