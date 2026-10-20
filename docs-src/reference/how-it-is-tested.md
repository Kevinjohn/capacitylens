---
title: How CapacityLens is tested
description: The automated test suites that run on CapacityLens, what each one covers, and approximately how large they are.
---

# How CapacityLens is tested

See what the automated checks cover before you rely on CapacityLens. It is alpha software with a
single maintainer, so those checks carry most of the safety net. Contributor check commands are
listed in [`CONTRIBUTING.md`](https://github.com/Kevinjohn/capacitylens/blob/main/CONTRIBUTING.md).

The suites follow the current frontend, backend and shared workspace packages. Counts change as coverage grows.

| Suite | Tool | Covers | Size (approximate) |
| --- | --- | --- | --- |
| App and shared unit tests | Vitest, Testing Library | The shared scheduling rules, the client store, and React components | About 310 test files |
| Backend tests | Japa | The API, authorisation, SQLite, immutable migration checks, backups and sign-in | Unit and functional suites |
| End-to-end tests | Playwright | Demo interaction coverage, SQLite-backed flows, authenticated scheduler gestures and password sign-in in a real browser | About 70 spec files |
| Accessibility checks | axe, inside the end-to-end tests | Automated accessibility rules on key screens | 7 spec files |
| Mutation testing | Stryker | Whether the unit tests fail when the scheduling logic is changed | Run on demand, not on every change |

## Limits of each suite

- Current migrations retain immutable checksums. Backup, upgrade and reset tests cover recognised
  journals, refusal of unknown history and recovery artifacts. Historical legacy database fixtures
  and the old migration rehearsal are retired.
- End-to-end tests run Chromium by default. WebKit and Firefox runs are opt-in.
- Demo scheduler tests exercise the in-memory experience. `*.auth.spec.ts` scheduler tests sign in
  through the password session and verify saved changes against the server's SQLite state; only
  those tests establish authenticated scheduler-write coverage.
- Axe finds common problems such as missing names and low contrast. It does not replace testing
  with assistive technology.
- Mutation testing covers only the pure scheduling and helper code, not the server or React
  screens.

The repository README shows CI status, code coverage, CodeQL, OpenSSF Scorecard and OpenSSF
Baseline badges. The [OpenSSF Baseline assessment](/security/OpenSSF-best-practices-dev) has the
evidence behind the Baseline badge.
