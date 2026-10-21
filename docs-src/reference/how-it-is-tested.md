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
| Backend tests | Japa | API behavior, authorization, SQLite, backups and sign-in |
| End-to-end tests | Playwright | Volatile demo interaction checks and authenticated SQLite scheduler gestures in a real browser |
| Accessibility checks | axe, inside the end-to-end tests | Automated accessibility rules on key screens |
| Mutation testing | Stryker | Whether focused tests detect changes to scheduling logic; run on demand |

## Limits of each suite

- Backup and upgrade tests cover supported databases and recovery behavior.
- End-to-end tests run Chromium by default. WebKit and Firefox runs are opt-in.
- Demo scheduler tests exercise the in-memory experience.
- Database-project scenarios exercise the retained legacy transport against SQLite in the fixture
  server's auth-off mode.
- The dedicated authenticated scheduler suite signs
  in through the real password session and verifies create, pointer move/resize, reassign,
  duplicate, repeat and delete with Undo/Redo against SQLite, one typed request per gesture, reload,
  acknowledgement-only refresh, stale-edit refusal and sign-out clearing. Only those real
  backend assertions establish authenticated scheduler-write coverage. The failure case injects
  a refused response; successful writes are never mocked.
- Planning-controller transition tests use controlled responses to check revision ordering,
  pending and uncertain outcomes (including HTTP 408), context invalidation, explicit server write
  authority and page-local typed history capped at 50 entries. A missing write capability rejects
  the snapshot; a read-only snapshot cannot open a writable draft or execute history. Completion results are suppressed if the initiating context changes during the
  post-commit read. Activity updates supplying a kind conservatively clear typed history because
  kind changes can discard allocation bindings that the inverse cannot recover. Activity updates
  omitting kind retain ordinary patch/history behavior, including project or phase changes. Settings
  updates and catalogue privacy/code-name updates also clear typed history. Pure command builders
  preserve captured fields and send explicit non-delete intents: an unchanged allocation copy uses
  source-ID duplication, while a copy with edited non-date fields uses explicit creation with a fresh
  ID. Scheduler booking commands use these builders. A separate
  authenticated browser harness exercises the controller through real typed routes and SQLite:
  create, move, resize, reassign, duplicate, repeat, grouped creation, archive/unarchive, update
  Undo/Redo, stale-edit refusal, lost-response
  commitment lookup and sign-out cache clearing. The schedule uses the controller for bookings,
  and Undo and Redo cover booking changes only. Server tests cover session-bound allocation deletion and restoration through the typed
  routes: each delete saves the removed rows as a group that only the deleting session can restore,
  once, with the original row and timestamps, and invalidating that session removes its groups.
  Time-off,
  closure and catalogue deletion still refuse typed restoration, and complete typed Undo remains
  unfinished; later identity-link integration is separate from this milestone, which uses the
  existing real authentication.
- Axe finds common problems such as missing names and low contrast. It does not replace testing
  with assistive technology.
- Mutation testing covers only the pure scheduling and helper code, not the server or React
  screens.

The repository README shows CI status, code coverage, CodeQL, OpenSSF Scorecard and OpenSSF
Baseline badges. The [OpenSSF Baseline assessment](/security/OpenSSF-best-practices-dev) has the
evidence behind the Baseline badge.
