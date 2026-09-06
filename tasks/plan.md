# Code conventions: names, parameters and results

Status: agreed 2026-09-06 (revision 3; revisions 1 and 2 reviewed and revised the same day). Base: `main` at `3bb01646`, version 0.60.1-alpha.1.
Issues: #636 (conventions page), #637 (lint enforcement), #638 (audit), #639 (debt retirement).
Previous batch (hygiene, PRs #632–#635) is complete; its plan is in git history.

AGENTS.md governs everything not stated here. No build, test or CI reads this file.

## Outcome

The repository has one page that says what a function name promises, how variables are named,
when parameters become an options object and what shape a result takes; the mechanical subset
of that page is enforced by lint against a committed baseline that can only shrink; and the
audit and debt-retirement work that follows is tracked in issues, not started here.

## Rules for the batch

- **Scope.** C1 and C2 only. No renames, signature changes or result-shape changes to satisfy
  the new page: every existing violation is recorded, never fixed, in this batch (#638, #639).
- **Hard exclusions.** No new dependencies, scripts, CI workflows or tooling beyond the two lint
  rules and the suppressions file ESLint already supports. No change to wire shapes, stable
  identifiers, schemas, migrations or fixtures.
- **Footprint is the contract.** Each task lists its files. An edit outside that list stops the
  task and reports.
- **Stop rule.** Two failed fix attempts on a focused check, or a boundary that cannot preserve a
  listed behaviour, stops the task with the obstacle, files changed and smallest remaining step.
- **Validation.** During implementation: `pnpm run lint`, `pnpm exec tsc -b`, `pnpm exec prettier
--check` on touched files, `pnpm run docs:build` for C1, and the task's focused checks. Before
  submission: one integration worktree merging both branches, `pnpm run gate`, `pnpm run
gate:server`, `pnpm run e2e`, Node >= 24, then the pull requests: the three commands AGENTS.md
  "Green gate" names. The longer list in `development.md` ("Checks") adds the OIDC browser suite,
  migration rehearsal, coverage and mutation runs, none of which a prose page or a lint rule can
  affect; `gate` already runs the coverage floors. Main CI after each merge is the GitHub evidence.
- **Release.** None. Both changes go under `Unreleased`; the next release picks them up.
- **Done means stop.** When C1 and C2 are merged and main is green, tick the completion record.

## Batch briefs

### C1 — Conventions page (#636)

**Facts.** `docs-src/reference/development.md:147–243` covers filenames, exports, acronyms,
account vocabulary, imports and ownership; nothing in the tree covers function verbs, variable
naming, parameter style or result shapes. `DECISIONS.md:336–344` ("Maintainable module
boundaries") says detailed naming tables live in the development guide, existing differences are
tracked debt, and documenting a convention does not itself make lint enforce it. The tree at
3bb01646, non-test source: `DEFENSIVE-CODING.md` section 2 fixes the validator contract
(`ValidationResult { ok, errors }` or a `fail` callback, never throw), yet exported `validate*`
functions return `ValidationResult` (3), `string | null` (2), `boolean` (2) and `T | null` (4);
`assertAccountAuthority` (`server/src/accounts/adminPort/authority.ts:29`) returns the `Role` it
established; parsers take three shapes: decoders return `null` (`parseISOTimestamp`), boundary
parsers throw (`parseData`, `shared/src/data/transfer.ts:31`), configuration parsers apply a
documented default (`parseRateLimit`, `server/src/rateLimit.ts:20`; `server/src/backup.ts:44`) or
refuse start-up (`parsePort`, `server/src/boot/refusals.ts:38`); in-memory lookups return `undefined` (`src/store/selectors.ts:108–114`)
and storage lookups return `null`; `ensureInternalClients` is exported from
`shared/src/data/internalClient.ts:138` returning `AppData` and from `server/src/db/repairs.ts:28`
returning `void`; `getRow` in `server/src/db/rows.ts:99` returns `Row | undefined` while the other
storage `get*` lookups return `T | null`; `make*` is used only by fixture factories in
`src/test/fixtures.ts`; `{ ok: true }` occurs in `ValidationResult`, server route responses and the import
worker message protocol; `handle*` names occur four times in `src/`, while callbacks passed to `on*` props are
plain verbs (`cancel`, `submit`). `docs-src/STYLE.md` defines the page shape: a concept page has
a title as a verb phrase, an opening paragraph, and one idea explained with a concrete example
before the rule, `title` and `description` front matter, and a definition of done that includes
checking the built page by eye in a browser. `.prettierignore` excludes `docs-src/`, so Prettier
never checks the Markdown. The sidebar is `docs-src/.vitepress/config.mts:145–150` ("Reference").
`DECISIONS.md:336–337` says the detailed naming tables live in the development guide.

**Fixed decisions.**

- New page `docs-src/reference/conventions.md`, already drafted on this branch. Its rules are the
  decisions: the verb table (with `assert` returning the established value, `parse` naming its
  three shapes, `validate` bound to the `DEFENSIVE-CODING.md` contract), a concrete example
  before the first rule per `docs-src/STYLE.md:30–31`, the
  abbreviation allowlist, three positional parameters and no flags, `kind` unions, `status` for
  lifecycle only, `ok` for `ValidationResult` and wire shapes only, absence following the source
  (`undefined` in memory, `null` from storage), tuples for labelled pairs only, no `find`/`handle`
  verbs, `make` for fixtures only, enforcement throwing per `DEFENSIVE-CODING.md`.
- The page states which rules lint enforces (casing, negated-boolean regex, `max-params` 3) and
  the prune command; this must match C2 exactly.
- `development.md` gets one sentence at the end of "Name modules and keep their contracts small"
  pointing at the page. `AGENTS.md` "Naming and module contracts" gets one bullet pointing at it.
  `CONTRIBUTING.md` gets one sentence beside the Prettier line (line 59). `DECISIONS.md:336–337`
  names the page beside the development guide. No other prose changes.
- Sidebar entry `{ text: "Code conventions", link: "/reference/conventions" }` after the
  development guide.
- `CHANGELOG.md` `Unreleased` entry under `### Added`.
- The counterexamples in the page are listed as debt only; none is changed here.

**Permitted discretion.** Wording; the exact sentence placement in the three linking files;
table column widths.

**Files.** `docs-src/reference/conventions.md` (new), `docs-src/.vitepress/config.mts`,
`docs-src/reference/development.md`, `AGENTS.md`, `CONTRIBUTING.md`, `DECISIONS.md`,
`CHANGELOG.md`, `docs/` (regenerated), `tasks/plan.md`.

**Focused tests.** `pnpm run docs:build` succeeds with no dead-link error and
`docs/reference/conventions.html` exists; the built page is opened in a browser and checked by
eye (sidebar entry, outline, table rendering); every path and symbol the page cites resolves at
the base (`grep -n` per citation).

**Done.** Page merged and built; the four pointers in place; #636 closed with the merge SHA.

### C2 — Lint enforcement with a suppressions baseline (#637)

**Facts.** `eslint.config.js` applies typed linting to `src/**`, `server/src/**`,
`server/scripts/**` and `shared/src/**` (two blocks, lines 99–131) and enforces only the two
promise rules there; no naming or parameter rule exists anywhere in the config. ESLint 10.8.1
(`package.json:121`) supports bulk suppressions: `--suppress-rule <rule>` writes
`eslint-suppressions.json` in the working directory, ordinary runs read that file by default,
a file whose count for a rule rises fails, and an unused suppression fails until
`--prune-suppressions` removes it. Probe at 3bb01646 with the rule set below over the typed
globs: `naming-convention` 15 (ten `COLS_<table>` constants in `server/src/tables/columns.ts`, one
PascalCase `let` in a test, four negated names such as `notTentativeHidden` in
`src/components/scheduler/schedulerRowModel.ts:31`); `max-params` at 3: 252 (167 source, 85 test);
a boolean-prefix requirement
would add 469 source hits, most of them shipped entity field names such as `ignoreWeekends`
destructured into variables, so it is excluded. `scripts/check-lint-coverage.test.mjs` lints
fixture files that contain no identifiers or parameters, so it stays green. `pnpm run lint` is
`eslint . --max-warnings 0`. `naming-convention` applies the first matching selector only, so a
custom regex must be repeated on every selector that names a value. Suppressions are counted per
file and rule: a rising count fails, a falling count fails until pruned, and a like-for-like
replacement at the same count passes.

**Fixed decisions.**

- One new block in `eslint.config.js` for the same four typed globs:
  - `max-params: ["error", 3]`.
  - `@typescript-eslint/naming-convention` with: default camelCase; `const` variables camelCase,
    UPPER_CASE or PascalCase; other variables camelCase; parameters camelCase or PascalCase;
    functions camelCase or PascalCase; `typeLike` PascalCase; `enumMember` PascalCase or
    UPPER_CASE; object, type and class properties, methods and imports unformatted
    (`format: null`) because many mirror wire and library names. Selectors are first-match, so
    `leadingUnderscore: "allow"` and the custom regex `^(hasNo|not[A-Z]|isNot(?!Null))`
    (`match: false`) are each repeated on the `default`, `const` variable, other variable and
    parameter entries (regex on the three value entries only).
  - No `types: ["boolean"]` selector and no prefix requirement.
- Baseline generated once with `pnpm exec eslint . --suppress-rule max-params --suppress-rule
@typescript-eslint/naming-convention` and committed as `eslint-suppressions.json`.
- `pnpm run lint` green with no other config change. No new script; the prune command is
  documented on the conventions page (C1) and in one sentence under "What `gate` checks" in
  `development.md`.
- `CHANGELOG.md` `Unreleased` entry under `### Changed`.
- The page's "What lint enforces" section (C1) states exactly this rule set and the count
  semantics.

**Permitted discretion.** Comment wording in the config block; whether the block sits before or
after the shared-globals block.

**Files.** `eslint.config.js`, `eslint-suppressions.json` (new), `docs-src/reference/development.md`,
`docs/` (regenerated, for the development.md sentence), `CHANGELOG.md`.

**Focused tests.** `pnpm run lint` exits 0; a scratch file with a four-parameter function and a
`notReady` variable fails lint and is deleted; `node --test scripts/check-lint-coverage.test.mjs`
passes; `pnpm exec prettier --check eslint.config.js eslint-suppressions.json`.

**Done.** Rules and baseline merged; #637 closed with the merge SHA.

## Later options (not selected; brief written when selected, against the base at that time)

- **C3 — Audit (#638).** Select after C1 merges. Read-only, one findings table per owner area
  in the development guide's ownership table, against the merged page.
- **C4 — Debt retirement (#639).** Select after C3 produces triaged batches. Renames in large
  batches, result-shape changes one module per change, baseline pruned each batch, one release
  per batch.

## Sequence

1. C1 and C2 on separate branches from 3bb01646; footprints overlap only in `CHANGELOG.md`,
   `docs-src/reference/development.md` and `docs/`, resolved at integration.
2. One integration worktree, full gates once, then both pull requests; C1 lands first so the
   page the lint sentence refers to exists.
3. Close #636 and #637 with merge SHAs. Stop.

## Completion record

- [ ] C1 merged: PR #, merge SHA
- [ ] C2 merged: PR #, merge SHA
- [ ] Main CI green on the final merge SHA
- [ ] #636 and #637 closed
