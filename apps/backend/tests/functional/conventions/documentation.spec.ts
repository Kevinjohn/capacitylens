import { test } from '@japa/runner';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  listDocumentationLinkFailures,
  listReadmeLinkFailures,
  listStoryFiles,
  listStoryPaths,
  readRepositoryFile,
  repositoryRoot,
  resolveLocalMarkdownTarget,
} from '#tests/helpers/documentation';

test.group('documentation and repository rule contracts', () => {
  test('keeps the README install commands and success check in step with the guide', ({
    assert,
  }) => {
    const installBlock = (text: string) => /```bash\n(sudo git clone[\s\S]*?)```/.exec(text)?.[1];
    const guide = readRepositoryFile('docs-src/self-hosting/install-without-docker.md');
    const readme = readRepositoryFile('README.md');
    assert.isString(installBlock(readme));
    assert.equal(installBlock(readme), installBlock(guide));
    for (const text of [readme, guide]) assert.include(text, '`"isHealthy":true`');
  });

  test('keeps local Markdown links from the public README resolvable', ({ assert }) => {
    assert.deepEqual(listReadmeLinkFailures(readRepositoryFile('README.md')), []);
  });

  test('checks same-page README links against its own headings', ({ assert }) => {
    const readme = [
      '[Try it](#try-it-in-two-minutes) · [Missing](#missing-section)',
      '[Contributing](CONTRIBUTING%2Emd?tab=docs#documentation-and-github-pages)',
      '<mailto:bruce@wayne.example> · [External](//example.test/path)',
      '',
      '## Try it in two minutes',
    ].join('\n');

    assert.deepEqual(listReadmeLinkFailures(readme), ['Missing README fragment #missing-section']);
  });

  test('reports the original target when a local README path cannot be decoded', ({ assert }) => {
    const target = 'docs-src%2Findex.md';
    const readme = `[Documentation](${target})`;

    assert.throws(() => listReadmeLinkFailures(readme), `Invalid local Markdown target ${target}`);
  });

  test('checks README links against literal HTML ids', ({ assert }) => {
    const readme = [
      '[Exact](#Review_Mixed-Case) · [Altered](#reviewmixed-case)',
      '',
      '<span id="Review_Mixed-Case"></span>',
    ].join('\n');

    assert.deepEqual(listReadmeLinkFailures(readme), ['Missing README fragment #reviewmixed-case']);
  });

  test('rejects README fragments found only in data attributes or fenced examples', ({
    assert,
  }) => {
    const readme = [
      '[Heading](#real-heading) · [HTML](#real-id) · [Data](#data-only) · [Example](#example-heading) · [Example HTML](#example-id)',
      '',
      '## Real heading',
      '',
      '<span id="real-id"></span>',
      '<span data-id="data-only"></span>',
      '',
      '```md',
      '## Example heading',
      '<span id="example-id"></span>',
      '```',
    ].join('\n');

    assert.deepEqual(listReadmeLinkFailures(readme), [
      'Missing README fragment #data-only',
      'Missing README fragment #example-heading',
      'Missing README fragment #example-id',
    ]);
  });

  test('checks every link on a story documentation metadata line', ({ assert }) => {
    const story = resolve(
      repositoryRoot,
      'user-stories/installation/US-INS-01-install-one-agency.md'
    );
    const install = '../../docs-src/self-hosting/install.md';
    const guide = '../../docs-src/self-hosting/install-without-docker%2Emd?from=story';
    const upgrades = '../../docs-src/self-hosting/upgrades.md';
    const metadata = `**Documentation:** [Install](${install}); [Guide](${guide}#missing-section); [Upgrades](${upgrades})`;

    assert.deepEqual(listDocumentationLinkFailures(story, metadata), [
      `Missing documentation fragment ${guide}#missing-section`,
    ]);
    assert.deepEqual(
      listDocumentationLinkFailures(story, metadata.replace('#missing-section', '')),
      []
    );
  });

  test('keeps both membership guide fragments resolvable', ({ assert }) => {
    const story = resolve(repositoryRoot, 'user-stories/team/US-TEAM-06-change-membership.md');
    const guide = '../../docs-src/admin/invite-teammates.md';
    const metadata = `**Documentation:** [Story](${guide}#change-a-members-role-or-schedule-row); [Guide](${guide}#change-a-member-s-role-or-schedule-row)`;

    assert.deepEqual(listDocumentationLinkFailures(story, metadata), []);
  });

  test('documents the native AdonisJS commands and health routes', ({ assert }) => {
    const install = readRepositoryFile('docs-src/self-hosting/install-without-docker.md');
    const operations = readRepositoryFile('docs-src/self-hosting/upgrades.md');
    const backups = readRepositoryFile('docs-src/self-hosting/backups-and-restore.md');
    const monitoring = readRepositoryFile('docs-src/self-hosting/monitoring.md');
    const operatorDocs = [install, operations, backups, monitoring].join('\n');

    for (const command of [
      'node ace.js app:upgrade',
      'node ace.js db:backup',
      'node ace.js owner:reset-password',
      'node ace.js app:reset',
    ])
      assert.include(operatorDocs, command);
    assert.include(monitoring, '/health/live');
    assert.include(monitoring, '/health/ready');
  });

  test('keeps current operator configuration tied to the packaged environment sample', ({
    assert,
  }) => {
    const configuration = readRepositoryFile('docs-src/self-hosting/configuration.md');
    const example = readRepositoryFile('packaging/release/capacitylens.env.example');
    for (const key of [
      'APP_KEY',
      'APP_URL',
      'CAPACITYLENS_PUBLIC_URL',
      'CAPACITYLENS_DB',
      'CAPACITYLENS_BACKUP_DIR',
    ]) {
      assert.include(example, `${key}=`);
      assert.include(configuration, `\`${key}\``);
    }
    assert.include(configuration, 'account-kit:admission:bootstrap');
    assert.include(configuration, '`CAPACITYLENS_MAIL_HOST`');
  });

  test('documents sole-owner password recovery as a stopped-server command', ({ assert }) => {
    for (const path of [
      'docs-src/self-hosting/backups-and-restore.md',
      'docs-src/self-hosting/incidents.md',
      'docs-src/self-hosting/faq.md',
    ]) {
      const document = readRepositoryFile(path).replace(/\s+/g, ' ');
      assert.include(document, 'owner:reset-password');
      assert.include(document, '--confirm-server-stopped');
    }
  });

  test('keeps user-story source and documentation references resolvable', ({ assert }) => {
    const sourceReferences =
      /`((?:apps\/backend|apps\/frontend|packages\/shared|e2e)\/[^`]+\.[cm]?[jt]sx?)`/g;
    const files = listStoryFiles();
    const catalogue = readRepositoryFile('user-stories/README.md');
    const indexed = [...catalogue.matchAll(/\]\(([^)]+\/US-[^)]+\.md)\)/g)].map(
      (match) => match[1]
    );
    assert.equal(Number(catalogue.match(/\n(\d+) stories across/)?.[1]), files.length);
    assert.equal(indexed.length, files.length);
    assert.equal(new Set(indexed).size, files.length);
    assert.deepEqual(indexed.toSorted(), listStoryPaths());

    const matrix = readRepositoryFile('user-stories/COVERAGE.md');
    const matrixPaths = [...matrix.matchAll(/\]\(([^)]+\/US-[^)]+\.md)\)/g)].map(
      (match) => match[1]
    );
    assert.deepEqual(
      matrixPaths.toSorted(),
      listStoryPaths(),
      'Every story appears once in the matrix'
    );
    const identifiers = new Set<string>();

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const identifier = content.match(/^# (US-[A-Z]+-\d+) — /)?.[1];
      assert.isDefined(identifier, `Missing story identifier: ${file}`);
      assert.isFalse(identifiers.has(identifier!), `Duplicate story identifier: ${identifier}`);
      identifiers.add(identifier!);
      assert.match(content.replace(/\s+/g, ' '), /As an? .+, I want .+ so that .+/);
      assert.match(content, /^\*\*Status:\*\* (?:Current|Hidden|Removed|Demo|Operator|Planned)\b/m);
      const pathInCatalogue = relative(resolve(repositoryRoot, 'user-stories'), file);
      const matrixRow = matrix.split('\n').find((line) => line.includes(`](${pathInCatalogue})`));
      const matrixStatus = matrixRow?.match(
        /\|\s*(Current|Hidden|Removed|Demo|Operator|Planned)\s*\|\s*(?:New|Existing)\s*\|$/
      )?.[1];
      const storyStatus = content.match(/^\*\*Status:\*\* (\w+)/m)?.[1];
      assert.equal(matrixStatus, storyStatus, `Matrix status differs for ${pathInCatalogue}`);
      assert.match(content, /^\*\*Access:\*\* \S/m);
      assert.match(content, /^\*\*Entry:\*\* \S/m);
      assert.match(content, /^\*\*Documentation:\*\* \[/m);
      assert.match(content, /^\*\*Source:\*\* \[/m);
      assert.match(content, /^## Acceptance criteria$/m);
      assert.match(content, /^(?:- \S|\|\s+Field\s+\|)/m);
      const metadata = content.split(/^## Acceptance criteria$/m, 1)[0] ?? '';
      for (const [, target] of content.matchAll(/\]\(([^)]+)\)/g)) {
        if (!target) continue;
        const link = resolveLocalMarkdownTarget(file, target);
        if (link) assert.isTrue(existsSync(link.path), `Missing story link ${target}`);
      }
      for (const [, path] of metadata.matchAll(sourceReferences)) {
        if (path)
          assert.isTrue(existsSync(resolve(repositoryRoot, path)), `Missing source ${path}`);
      }
      assert.deepEqual(listDocumentationLinkFailures(file, metadata), [], file);
    }
  });

  test('keeps a user flow and a source-linked code flow on every story', ({ assert }) => {
    for (const file of listStoryFiles()) {
      const content = readFileSync(file, 'utf8');
      assert.lengthOf([...content.matchAll(/^## User flow$/gm)], 1, file);
      assert.lengthOf([...content.matchAll(/^## Code flow$/gm)], 1, file);
      const userStart = content.indexOf('## User flow');
      const codeStart = content.indexOf('## Code flow');
      assert.isBelow(userStart, codeStart, `User flow must precede code flow: ${file}`);
      const userFlow = content.slice(userStart, codeStart);
      assert.match(userFlow, /^```mermaid\n[\s\S]+?^```$/m, `Missing user flowchart: ${file}`);
      const diagrams = [...content.matchAll(/^```mermaid\n([\s\S]+?)^```$/gm)];
      assert.lengthOf(diagrams, 2, `Expected user and code diagrams: ${file}`);
      for (const diagram of diagrams) assert.match(diagram[1]!, /^flowchart (?:TD|LR)\b/, file);
      assert.match(content.slice(codeStart), /^\*\*Code references:\*\*\s+(?:- )?\[/m, file);
    }
  });
});
