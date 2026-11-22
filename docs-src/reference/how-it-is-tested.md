---
title: How CapacityLens is tested
description: The automated checks used to validate CapacityLens and what each one covers.
---

# How CapacityLens is tested

Contributor check commands are listed in [`CONTRIBUTING.md`](https://github.com/Kevinjohn/capacitylens/blob/main/CONTRIBUTING.md).

The suites cover the frontend, backend and shared workspace packages.

| Suite | Tool | Covers |
| --- | --- | --- |
| App and shared unit tests | Vitest, Testing Library | Shared scheduling rules, the client store and React components |
| Backend tests | Japa | API behaviour, authorisation, SQLite, backups and sign-in |
| End-to-end tests | Playwright | Authenticated SQLite interaction checks and scheduler gestures in real browsers |
| Accessibility checks | axe, inside the end-to-end tests | Automated accessibility rules on key screens |
| Mutation checks | By hand, in review | Whether the tests for the changed code fail when that code is reverted or altered; see step 6 of [Contributing](https://github.com/Kevinjohn/capacitylens/blob/main/CONTRIBUTING.md#your-first-change) |

## Limits of each suite

- Backup and upgrade tests cover supported databases and recovery behaviour.
- End-to-end tests run Chromium by default. WebKit and Firefox runs are opt-in, and run only the tests tagged `@engine`: those whose result can differ between engines, such as dragging, keyboard movement, focus, scrolling, native inputs and layout. Chromium runs every test.
- Every browser project exercises the real server. Each parallel worker owns an API, Vite proxy and SQLite database; fixture resets preserve sign-ins and restore company data before authentication.
- Database-project scenarios use authenticated sessions against SQLite; persisted server data is
  never available anonymously.
- The dedicated authenticated scheduler suite signs
  in through the real password session and verifies create, pointer move/resize, reassign,
  duplicate, repeat and delete with Undo/Redo against SQLite, one typed request per gesture, reload,
  acknowledgement-only refresh, stale-edit refusal and sign-out clearing. Only those real
  backend assertions establish authenticated scheduler-write coverage. The failure case injects
  a refused response; successful writes are never mocked.
- Planning-controller transition tests use controlled responses to check revision ordering,
  pending and unconfirmed outcomes (including HTTP 408), context invalidation, explicit server write
  authority, the page's history id on every read and write, and Undo and Redo availability taken
  only from the read. A missing write capability rejects
  the snapshot; a read-only snapshot cannot open a writable draft or execute history. Completion results are suppressed if the initiating context changes during the
  post-commit read. A context change or a lost reply starts a new history id, and a refused Undo or
  Redo is followed by a read. The test transport keeps the server's history rules: it swaps recorded
  before and after rows, and ends a history on another id, no id or a revision it does not hold.
  Server tests cover the history itself: its limit, what ends it and its stored inverses. Pure
  command builders
  preserve captured fields and send explicit non-delete intents: an unchanged allocation copy uses
  source-ID duplication, while a copy with edited non-date fields uses explicit creation with a fresh
  ID. Scheduler booking commands use these builders. A separate
  authenticated browser harness exercises the controller through real typed routes and SQLite:
  create, move, resize, reassign, duplicate, grouped creation, archive/restore, update
  Undo/Redo, stale-edit refusal, lost-response
  recovery by refetch and sign-out cache clearing. The schedule uses the controller for bookings,
  and Undo/Redo step through the server-held history for the page. History is
  cleared on context changes and does not cover imports or irreversible privacy actions. Server
  tests cover session-bound deletion and restoration of bookings,
  time off, closures, phases and disciplines through the typed routes. Deleted rows stay hidden
  from reads and exports. Only the deleting session can restore each group once, with the original
  IDs and timestamps. Tests cover fresh Redo handles, surviving-child
  links, failed-transaction rollback and cleanup after sign-out, revocation, expiry, credential
  changes, privacy changes, anonymisation and import. Old groups cannot affect restored,
  replacement or newer-deleted rows. Catalogue and resource screens keep their archive controls.
  Server recovery tests do not establish complete screen-level Undo coverage.

- Axe finds common problems such as missing names and low contrast. It does not replace testing
  with assistive technology.
- Mutation checks are done by hand on the code a change touches. No tool measures how well the
  tests detect changes to the rest of the code.

The repository README shows CI status, code coverage, CodeQL, OpenSSF Scorecard and OpenSSF
Baseline badges. The [OpenSSF Baseline assessment](/security/OpenSSF-best-practices-dev) has the
evidence behind the Baseline badge.
