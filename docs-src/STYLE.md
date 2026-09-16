# Documentation style guide

This is the standard every page in `docs-src/` follows. It applies to new pages, rewrites,
and reviews. When a page and this guide disagree, fix the page.

## Who we write for

A busy person at a small agency who has never read our code and never will. They may be
non-technical (an office manager inviting the team) or technical-but-in-a-hurry (a
freelance sysadmin doing the install). Both should be able to scan a page and know in
five seconds whether it answers their question.

## The shape of a page

Choose the structure that helps someone use the screen or complete their task.

### Application page introductions

Readers understand agency work. They need to understand this interface.

- Use the application's page name as the title.
- Show the screen before explaining the useful controls or interactions.
- Keep each paragraph on one subject. Separate navigation advice from explanations.
- Remove obvious definitions and narration of what the image already makes clear.
- Use lists when a list helps, not as a substitute for editing a paragraph.
- Use bold selectively. Repeated bold lead-ins make emphasis ineffective.
- Add another image when the view changes or a useful interaction needs highlighting.
- Link to detailed guidance without requiring readers to follow a chapter sequence.

“Why would someone open this page?” and “Where is the information they need?” are
editorial questions, not required headings. Avoid learning-outcome summaries and commentary
about reading the guide. There is no target paragraph count or page length: every section
must provide value and remain easy to scan.

Essential controls and outcomes must also be clear in text, so the guide works for people
using assistive technology and for language models without access to the images.

### Task instructions

Use a short task title, necessary context and prerequisites, then the actions needed.
Number steps when order matters. Show the relevant screen before asking the reader to act.
Explain important results and link to related help where useful. Do not force every page
into an opening paragraph, steps and “What's next” template.

## Applying this to each guide

Most readers were sent here by their agency. They need enough information to use the
software now, with somewhere to return for detail. Do not assume they chose it or want
to study it.

- Start with the reader's job and the screen they will use. Keep application page names
  for page introductions; use action titles for procedures.
- Explain unfamiliar application behaviour, not familiar agency concepts. Clients does
  not need a definition of a client. A placeholder resource does need an explanation.
- Put an image beside the instruction it supports, before the action. A second image
  earns its place by revealing a changed view, a hidden control or a meaningful result.
  Do not add another full-screen image merely because the next sentence mentions a control.
- Keep related explanation together. Give a separate decision, exception or destination
  its own paragraph. Do not turn every sentence into a bullet.
- Make the next action locatable: name the page, control and useful result. Avoid generic
  commands such as “open the schedule” without a location, or “read each bar”.
- Keep essential information in the chosen guide. Reuse concise instructions where roles
  overlap; link out for depth rather than sending readers to another role's onboarding.
- State access restrictions where they affect an action. Explain what to do if access is
  missing, without making every reader study the permission model.
- Write FAQs around actual interruptions: a missing invitation, an unavailable control,
  an unexpected result. Avoid repeating the introduction as questions and answers.

### Owner, Admin and Settings

An Owner needs to establish the company, invite an Admin and know what remains their
responsibility. Make that handover a complete route; do not require ongoing administration
as the next chapter.

An Admin needs their own complete route for inviting teammates, assigning access, preparing
scheduled people and work, and managing company settings. Do not assume they have read the
Owner guide. Distinguish a sign-in invitation from a scheduled resource at the point where
someone needs to create them.

Settings guidance must distinguish personal display choices from company-wide changes.
For each company setting, show where it is, explain its effect and who it affects, and
include any consequence needed to make the decision. Avoid a catalogue that merely
paraphrases each label.

Each role guide has its own FAQ. Link to technical operations only when the task actually
requires an operator.

### Editorial acceptance check

Before calling a page ready, check:

- Can someone recognise the screen and locate the useful action without reading another guide?
- Does each paragraph add information needed to act, interpret a result or recover?
- Does each additional image teach something the preceding image cannot show?
- Are unrelated instructions and links visually separate, with emphasis used sparingly?
- Can the reader stop here and do something useful, with deeper help available when needed?

A short page is complete when it answers the need. Do not add headings, images or summaries
to make it look substantial.

## Rules

- **Keep a clear focus.** A page introduction may cover several related interactions. Separate detailed procedures when they would obscure that introduction.
- **Plain language.** Prefer the everyday word: "sign in" not "authenticate", "company
  login" not "IdP-initiated SSO", "link" not "federate". The first use of any term in
  the [glossary](reference/glossary.md) links to it. Jargon that has no everyday
  substitute (OIDC, TOTP) is allowed _after_ the glossary link.
- **Short sentences, active voice.** If a sentence needs a second comma, try splitting it.
- **Time estimates are honest.** "Two minutes" means two minutes on a laptop with
  Docker already installed, and the page says so.
- **Preview placeholders.** During an explicitly agreed content-review stage, use labelled
  `https://placehold.co/686x385?text=...` images. Their text and alt text describe the
  intended view. They are placeholders, never evidence of the application UI.
- **Screenshots are real.** Every screenshot is captured from the running app (the
  access lab: `pnpm run dev:access`), lives in `docs-src/screenshots/`, and has alt text
  describing what it shows. Never mock up a screenshot. If the UI changes, recapture.
- **Bearer-bearing screens are publication reviewed.** Redact hosts and secret values before
  capture. Sensitive screenshots listed in `screenshots/publication-review.json` are SHA-256
  pinned; after changing one, inspect it at full size for usable credentials before updating its
  reviewed digest.
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
4. Screenshots show the current UI, or an agreed preview clearly labels its temporary placeholders.
