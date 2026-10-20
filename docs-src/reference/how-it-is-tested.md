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
- Demo scheduler tests exercise the in-memory experience. The authenticated scheduler suite signs
  in through the real password session and verifies create, pointer move/resize, delete and
  Undo/Redo against SQLite, including reload and acknowledgement-only refresh. Only those real
  backend assertions establish authenticated scheduler-write coverage. The failure case injects
  a refused response; successful writes are never mocked.
- Axe finds common problems such as missing names and low contrast. It does not replace testing
  with assistive technology.
- Mutation testing covers only the pure scheduling and helper code, not the server or React
  screens.

The repository README shows CI status, code coverage, CodeQL, OpenSSF Scorecard and OpenSSF
Baseline badges. The [OpenSSF Baseline assessment](/security/OpenSSF-best-practices-dev) has the
evidence behind the Baseline badge.
