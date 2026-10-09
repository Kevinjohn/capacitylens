# US-SET-03 — Report which build I'm on (build stamp)

**Area:** Diagnostics · **Persona:** Owner or Admin reporting a problem · **Linked E2E:** `e2e/settings-build-stamp.spec.ts` → default build omits build details

> **Flag-gated:** the stamp only exists in builds made with `VITE_CAPACITYLENS_BUILD_SHA` set
> (the deploy script does this). A build with no stamp and no feedback link omits the **Build
> details** row.

**Documentation:** [Diagnostics](../../docs-src/admin/diagnostics.md)

## Goal

Tell the team exactly which build and backend mode a bug report is about, by reading the
one-line stamp on **Diagnostics → Build details**.

## Why

Testers report "it broke" against a moving target. The stamp pins the report to a commit
(`build a1b2c3d`) and proves the deploy is really in server mode — a build accidentally
running the in-memory demo build otherwise looks similar. `· server` vs `· demo` is the
difference between a shared-data deployment and temporary in-memory demo data, and the post-deploy
smoke test checks it first.

## How (end-to-end)

**Precondition (hosted demo):** open the deployed site, sign in past Basic Auth as an Owner
or Admin, pick a company; click **Diagnostics** below Settings in the sidebar.

1. Scroll to **Build details** below the support report.
2. Read the muted build line: `build <sha> · server` (`data-testid="build-stamp"`).
3. Include that exact line in any feedback or bug report.

**Precondition (default local build):** run `pnpm run dev`, open Diagnostics.

4. Confirm there is **no** build stamp and no **Build details** section.

## Acceptance criteria

- On a build with `VITE_CAPACITYLENS_BUILD_SHA=<sha>`, **Diagnostics → Build details** shows a muted one-line stamp
  `build <sha> · server` by default (same-origin server or a different origin configured with
  `VITE_CAPACITYLENS_API`), or `build <sha> · demo` when `VITE_CAPACITYLENS_DEMO=1` selects the
  in-memory build.
- On a build without the variable and without a feedback link, the **Build details** section is
  absent in both server and demo mode.
- The stamp is plain text (no control, no link) and does not affect the axe audit.
