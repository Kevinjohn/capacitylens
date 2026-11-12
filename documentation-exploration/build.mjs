import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMarkdownRenderer } from 'vitepress';
import { parse } from 'yaml';
import { format, resolveConfig } from 'prettier';
import { buildFaq } from './build-faq.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const formatOptions = await resolveConfig(fileURLToPath(import.meta.url));
async function writeHtml(path, html) {
  await writeFile(path, await format(html, { ...formatOptions, parser: 'html' }));
}
const tasks = [
  'plan-next-week',
  'get-access',
  'add-people',
  'add-work',
  'add-time-off',
  'find-capacity',
  'book-work',
  'resolve-overbooking',
  'check-your-week',
  'update-the-plan',
];
const labels = [
  'Plan next week',
  'Get access',
  'Add people',
  'Add work',
  'Add time off',
  'Find capacity',
  'Book work',
  'Resolve overbooking',
  'Check your week',
  'Update the plan',
];
const questions = [
  'Where should I start?',
  'How do teammates get in?',
  'How do I add scheduled people?',
  'How do I prepare project work?',
  'How do I account for absence?',
  'Who has room for work?',
  'How do I make a booking?',
  'What if someone is overbooked?',
  'Where is my work?',
  'How do I keep the plan current?',
];
const variants = [
  {
    key: 'handbook',
    letter: 'A',
    name: 'Task handbook',
    purpose: 'Enter at the task you need, with the full route always beside you.',
    tradeoff: 'Fast repeat reference; the navigation takes more space.',
    className: 'handbook',
  },
  {
    key: 'guided',
    letter: 'B',
    name: 'First-week walkthrough',
    purpose: 'Follow one practical route from a ready company to a checked plan.',
    tradeoff: 'Clear forward momentum; repeat visitors need the All steps menu.',
    className: 'guided',
  },
  {
    key: 'answers',
    letter: 'C',
    name: 'Answer desk',
    purpose: 'Comparison only: a question-led main structure, outside the selected direction.',
    tradeoff: 'Strong entry points for interruptions; less emphasis on a continuous route.',
    className: 'answers',
  },
];
const stem = (i) => `${String(i + 1).padStart(2, '0')}-${tasks[i]}`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const md = await createMarkdownRenderer(root, { html: true, linkify: false });
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = token.attrGet('src');
  const alt = md.renderer.renderInlineAsText(token.children ?? [], md.options, {});
  return `<a class="screenshot" href="${esc(src)}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></a>`;
};
const faqCoverage = await buildFaq(root, formatOptions);
const reportNames = ['research', 'sources', 'verification', 'faq', 'faq-coverage'];
const reportLabels = {
  research: 'Comparison report',
  sources: 'Source notes',
  verification: 'Verification record',
  faq: 'FAQ appendix',
  'faq-coverage': 'Story coverage',
};
const renderLink = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  if (!env.report) return renderLink(tokens, idx, options, env, self);
  const token = tokens[idx];
  const href = token.attrGet('href');
  if (
    href &&
    /^(?:\.\/)?(?:research|sources|verification|faq|faq-coverage)\.md(?:[?#]|$)/.test(href)
  ) {
    token.attrSet('href', href.replace(/\.md(?=[?#]|$)/, '.html'));
  }
  return self.renderToken(tokens, idx, options);
};
const reports = await Promise.all(
  reportNames.map(async (name) => {
    const source = resolve(root, `${name}.md`);
    const body = await readFile(source, 'utf8');
    const headings = body.match(/^# (.+)$/gm);
    if (headings?.length !== 1) throw new Error(`Expected one H1: ${source}`);
    return {
      name,
      title: headings[0].slice(2),
      article: md.render(body, {
        report: true,
        path: source,
        relativePath: relative(root, source),
      }),
    };
  }),
);
const pages = await Promise.all(
  variants.map(async (variant) =>
    Promise.all(
      tasks.map(async (_, i) => {
        const source = resolve(root, 'samples', variant.key, `${stem(i)}.md`);
        const raw = await readFile(source, 'utf8');
        const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        if (!match) throw new Error(`Missing front matter: ${source}`);
        const metadata = parse(match[1]);
        for (const field of ['title', 'description', 'audience', 'screen']) {
          if (typeof metadata[field] !== 'string' || !metadata[field].trim())
            throw new Error(`Missing ${field}: ${source}`);
        }
        if (match[2].match(/^# /gm)?.length !== 1 || !match[2].includes(`# ${metadata.title}`))
          throw new Error(`Expected one matching H1: ${source}`);
        const destination = resolve(root, 'preview', variant.key, `${stem(i)}.html`);
        let article = md.render(match[2], { path: source, relativePath: relative(root, source) });
        article = article.replace(/\b(href|src)="([^"]+)"/g, (_, attr, url) => {
          if (/^(?:[a-z]+:|#|\/)/i.test(url)) return `${attr}="${url}"`;
          const rewritten = url.replace(/\.md(?=#|$)/, '.html');
          return `${attr}="${rewritten}"`;
        });
        return { metadata, article, destination };
      }),
    ),
  ),
);

const list = (current) =>
  `<ol>${tasks.map((_, i) => `<li><a href="${stem(i)}.html"${i === current ? ' aria-current="page"' : ''}>${labels[i]}</a></li>`).join('')}</ol>`;
const directory = (current) =>
  `<div class="question-groups">${[
    [0, 4, 'Prepare the team'],
    [4, 8, 'Make a feasible plan'],
    [8, 10, 'Use and maintain it'],
  ]
    .map(
      ([start, end, heading]) =>
        `<section><h2>${heading}</h2><ul>${tasks
          .slice(start, end)
          .map((_, offset) => {
            const i = start + offset;
            return `<li><a href="${stem(i)}.html"${i === current ? ' aria-current="page"' : ''}>${questions[i]}</a></li>`;
          })
          .join('')}</ul></section>`,
    )
    .join('')}</div>`;
const document = (title, description, body, className, css) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="${esc(description)}"><title>${esc(title)} · CapacityLens documentation preview</title><link rel="stylesheet" href="${css}"></head><body class="${className}"><a class="skip" href="#main">Skip to content</a>${body}</body></html>\n`;
for (const [v, variant] of variants.entries()) {
  await mkdir(resolve(root, 'preview', variant.key), { recursive: true });
  for (const [i, page] of pages[v].entries()) {
    const route = list(i);
    const header = `<header class="site-header"><a class="brand" href="../../index.html">CapacityLens <span>Documentation exploration</span></a><a href="../../index.html">Compare options</a></header><div class="preview-note">Editorial preview · ${variant.letter}: ${variant.name} · Actual product unchanged</div>`;
    const switcher = `<nav class="compare" aria-label="Same task in another option"><span>Compare this task:</span>${variants.map((other) => `<a href="../${other.key}/${stem(i)}.html" aria-label="Option ${other.letter}: ${other.name}"${other.key === variant.key ? ' aria-current="page"' : ''}>${other.letter}<span> ${other.name}</span></a>`).join('')}</nav>`;
    const menu = `<details class="route-menu"><summary>${variant.key === 'guided' ? 'All steps' : 'Browse tasks'}</summary><nav aria-label="All tasks">${variant.key === 'answers' ? directory(i) : route}</nav></details>`;
    const sidebar =
      variant.key === 'handbook'
        ? `<aside class="sidebar"><nav aria-label="Task handbook"><p class="nav-label">Your next-week plan</p>${route}</nav></aside>`
        : '';
    const content = `<main id="main" tabindex="-1"><div class="page-context"><p>${variant.key === 'guided' ? `Step ${i + 1} of 10 · ` : ''}${esc(page.metadata.screen)}</p><p><strong>For:</strong> ${esc(page.metadata.audience)}</p></div><article>${page.article}</article><nav class="page-turn" aria-label="${variant.key === 'guided' ? 'Reading route' : 'Related tasks'}">${i > 0 ? `<a rel="prev" href="${stem(i - 1)}.html"><span>Previous</span>${labels[i - 1]}</a>` : '<span></span>'}${i < 9 ? `<a rel="next" href="${stem(i + 1)}.html"><span>Next</span>${labels[i + 1]}</a>` : '<a href="../../index.html">Return to comparison</a>'}</nav>${variant.key === 'answers' ? `<nav class="answer-directory" aria-label="Find another answer"><h2>Find another answer</h2>${directory(i)}</nav>` : ''}</main>`;
    await writeHtml(
      page.destination,
      document(
        page.metadata.title,
        page.metadata.description,
        `${header}${switcher}${menu}<div class="layout">${sidebar}${content}</div><footer>CapacityLens · Standalone editorial sample · <a href="../../faq.html">FAQ appendix</a> · <a href="../../research.html">Read the comparison report</a></footer>`,
        variant.className,
        '../../preview.css',
      ),
    );
  }
}
const table = `<div class="table-scroll"><table><caption>The same ten destinations in each option</caption><thead><tr><th scope="col">Task</th>${variants.map((v) => `<th scope="col">${v.letter}: ${v.name}</th>`).join('')}</tr></thead><tbody>${tasks.map((_, i) => `<tr><th scope="row">${labels[i]}</th>${variants.map((v) => `<td><a href="preview/${v.key}/${stem(i)}.html">${v.letter} · ${i + 1}. ${esc(pages[variants.indexOf(v)][i].metadata.title)}</a></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const landing = `<header class="site-header"><a class="brand" href="index.html">CapacityLens <span>Documentation exploration</span></a><a href="research.html">Comparison report</a></header><main id="main" class="landing" tabindex="-1"><p class="eyebrow">Editorial preview · Actual product unchanged</p><h1>Three ways to find your next step</h1><p class="lede">One journey: the company is already set up, the team makes a feasible plan for next week, and a Viewer can find their work. Compare the writing and navigation before choosing a direction.</p><p>The selected direction is a task-led guide with an intention-led entrance and a comprehensive <a href="faq.html">FAQ appendix</a>. A is the foundation; B offers an optional walkthrough. C remains available for comparison.</p><p>All three options cover the same ten destinations. The sequence is optional: start at the task you need. These are documentation samples, not a new product interface.</p><section aria-labelledby="options"><h2 id="options">Choose an option</h2>${variants.map((v) => `<section class="option"><h3><a href="preview/${v.key}/${stem(0)}.html">${v.letter} · ${v.name}</a>${v.key === 'handbook' ? ' <span class="recommendation">Recommended</span>' : ''}</h3><p>${v.purpose} ${v.tradeoff}${v.key === 'handbook' ? ' Recommended because it supports both first planning and returning directly to a task without hiding the route.' : ''}</p><p><a href="preview/${v.key}/${stem(0)}.html">Start with planning</a> · <a href="preview/${v.key}/${stem(6)}.html">Compare the first booking</a> · <a href="samples/${v.key}/${stem(0)}.md">Read the Markdown source</a></p></section>`).join('')}</section><section><h2>Compare by task</h2><p>Use the same-task switcher on any sample to move between A, B and C without losing your place.</p>${table}</section><p><a href="faq.html">Read the FAQ appendix</a> · <a href="research.html">Read the comparison report and recommendation</a> · <a href="sources.html">Source notes</a> · <a href="verification.html">Verification record</a></p></main><footer>Local, script-free preview. Screenshots link to their full-size originals.</footer>`;
await writeHtml(
  resolve(root, 'index.html'),
  document(
    'Three documentation options',
    'Compare three documentation approaches for planning next week in CapacityLens.',
    landing,
    'comparison',
    'preview.css',
  ),
);
for (const report of reports) {
  const navigation =
    report.name === 'faq'
      ? ''
      : `<nav class="report-nav" aria-label="Research documents">${reports.map((item) => `<a href="${item.name}.html"${item.name === report.name ? ' aria-current="page"' : ''}>${reportLabels[item.name]}</a>`).join('')}</nav>`;
  const returnLink =
    report.name === 'faq'
      ? '<a href="preview/handbook/01-plan-next-week.html">Back to the guide</a>'
      : '<a href="index.html">Compare options</a>';
  const footer =
    report.name === 'faq'
      ? returnLink
      : `<a href="index.html">Compare the three options</a> · <a href="${report.name}.md">Markdown source</a>`;
  const body = `<header class="site-header"><a class="brand" href="index.html">CapacityLens <span>Documentation exploration</span></a>${returnLink}</header><div class="preview-note">Editorial preview · Actual product unchanged</div>${navigation}<main id="main" class="report-article" tabindex="-1"><article>${report.article}</article></main><footer>${footer}</footer>`;
  await writeHtml(
    resolve(root, `${report.name}.html`),
    document(
      report.title,
      report.name === 'faq'
        ? 'Answers about planning, people, bookings, company access and data in CapacityLens.'
        : 'Documentation research and evaluation for CapacityLens.',
      body,
      'report',
      'preview.css',
    ),
  );
}
console.log(
  `Built 30 sample pages, five appendices/reports and the index; FAQ covers ${faqCoverage.stories} stories in ${faqCoverage.questions} questions.`,
);
