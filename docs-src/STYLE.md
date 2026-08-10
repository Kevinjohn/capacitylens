# Documentation style guide

This is the standard every page in `docs-src/` follows. It applies to new pages, rewrites,
and reviews. When a page and this guide disagree, fix the page.

## Who we write for

A busy person at a small agency who has never read our code and never will. They may be
non-technical (an office manager inviting the team) or technical-but-in-a-hurry (a
freelance sysadmin doing the install). Both should be able to scan a page and know in
five seconds whether it answers their question.

## The shape of a page

Every task page follows the same skeleton:

1. **Title** — a verb phrase describing the task ("Invite your team"), never a noun dump
   ("Team invitation management").
2. **Opening paragraph** — one short paragraph saying what the reader will have when
   they finish, who this page is for, and roughly how long it takes. No history, no
   architecture, no throat-clearing.
3. **Prerequisites** (only if there are any) — a short bulleted list with links.
4. **Numbered steps** — each step starts with the action, in the imperative ("Click
   **Settings**", "Run the command below"). One action per step. Show the result the
   reader should see after the important steps: a screenshot, a terminal output block,
   or a sentence ("The invite appears in the list with a _Pending_ tag").
5. **What's next** — one or two links to the page a reader most likely needs after
   this one.

Concept pages (the minority) drop the numbered steps and instead explain one idea in
plain language, with a concrete example before any general rule.

**Exception: long multi-stage pages.** A page covering several distinct stages, where
each stage has its own sub-steps (for example, a full migration procedure), may number
its own H2 stages (`## 1. …`, `## 2. …`) instead of a single `## Steps` list. Every
other page uses the standard numbered-list-under-`## Steps` pattern.

## Rules

- **One task per page.** If a page needs two H1-worthy verbs, it is two pages.
- **Plain language.** Prefer the everyday word: "sign in" not "authenticate", "company
  login" not "IdP-initiated SSO", "link" not "federate". The first use of any term in
  the [glossary](reference/glossary.md) links to it. Jargon that has no everyday
  substitute (OIDC, TOTP) is allowed _after_ the glossary link.
- **Short sentences, active voice.** If a sentence needs a second comma, try splitting it.
- **Time estimates are honest.** "Two minutes" means two minutes on a laptop with
  Docker already installed, and the page says so.
- **Screenshots are real.** Every screenshot is captured from the running app (the
  access lab: `pnpm run dev:access`), lives in `docs-src/screenshots/`, and has alt text
  describing what it shows. Never mock up a screenshot. If the UI changes, recapture.
- **Screenshots are click-to-enlarge, so capture them large.** A plain `![alt](path)` is
  automatically wrapped in a lightbox and shown at its natural size when clicked, so
  capture at least ~1400px wide and don't downscale before committing — the text column
  is only ~690px, and the enlarged view is the whole point. Nothing to write in the
  Markdown, and nothing to opt into. The one image that does not get it is one you have
  made a link yourself (`[![alt](path)](target)`), since the click has to mean one thing
  or the other. The mechanism is CSS by necessity
  (`docs-src/.vitepress/lightbox.mts` explains why): the published docs ship no JavaScript
  beyond one inline handler for the Escape key, so never reach for a lightbox library.
- **Commands are copy-pasteable.** One command per block, no `$` prompts, and the
  expected output (or the relevant part of it) shown after.
- **No cards.** Prose, lists, tables and steps only. Tables are for genuinely tabular
  facts (role × permission); never for layout.
- **Warnings earn their box.** Use a `::: warning` container only when ignoring it
  loses data or locks someone out. Use `::: tip` sparingly; most tips are just the
  next sentence.
- **Links say where they go.** "See [Backups and restore](self-hosting/backups-and-restore.md)",
  never "see here" or "click this".
- **Don't invent.** Everything a page claims must be verifiable in the running app or
  the repo. When in doubt, run it.

## Words we don't use

| Instead of                    | Write                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------ |
| authenticate / authentication | sign in / sign-in (the glossary covers the rest)                               |
| IdP                           | company login provider (link _identity provider_ in the glossary on first use) |
| provision / deprovision       | create / remove                                                                |
| utilize, leverage             | use                                                                            |
| in order to                   | to                                                                             |
| via                           | through, with                                                                  |
| e.g. / i.e.                   | for example / that is                                                          |
| the user                      | the person, your teammate, or "you"                                            |

A technical noun in operator-facing self-hosting docs may stand where "sign-in" would
be wrong or is pinned by a setting name — for example, "password authentication" as
the name of a deployment mode.

## Front matter

Every page sets a `title` and a one-line `description` in front matter. The
description is what search results and link previews show — write it as an answer,
not a label.

## Definition of done

A docs change is done when:

1. `pnpm run docs:build` passes with no dead-link errors.
2. The page renders correctly in the built site — checked by eye, in the browser,
   including the sidebar position, breadcrumbs and "On this page" outline.
3. Every new term is either everyday language or linked to the glossary.
4. Screenshots show the current UI.
