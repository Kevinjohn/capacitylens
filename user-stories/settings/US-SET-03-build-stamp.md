# US-SET-03 — Report which build I'm on (build stamp)

**Area:** Settings · **Persona:** Tester on the hosted demo · **Linked E2E:** `e2e/settings-build-stamp.spec.ts` → "no build stamp in the default dev build"

> **Flag-gated:** the stamp only exists in builds made with `VITE_CAPACITYLENS_BUILD_SHA` set
> (the deploy script does this). An unstamped server build still shows the named **Build details**
> row for **Persistence diagnostics**; a demo build with no stamp or feedback link omits that row.

**Documentation:** [Settings](../../docs-src/guide/settings.md)

## Goal

Tell the team exactly which build and persistence mode a bug report is about, by reading
the one-line stamp in Settings → **Data and support → Build details**.

## Why

Testers report "it broke" against a moving target. The stamp pins the report to a commit
(`build a1b2c3d`) and proves the deploy is really in server mode — a build accidentally
running the in-memory demo build otherwise looks similar. `· server` vs `· demo` is the
difference between a shared-data deployment and temporary in-memory demo data, and the post-deploy
smoke test checks it first.

## How (end-to-end)

**Precondition (hosted demo):** open the deployed site, sign in past Basic Auth, pick a
company; click **Settings** in the sidebar.

1. Scroll to **Data and support → Build details**.
2. Read the muted build line: `build <sha> · server` (`data-testid="build-stamp"`).
3. Include that exact line in any feedback or bug report.
4. If the problem concerns saving or reloading, open **Persistence diagnostics** in the same row and include its
   counts and suspended state. These are device-session counters and contain no scheduling values.

**Precondition (default local build):** run `pnpm run dev`, open Settings.

5. Confirm there is **no** build stamp. In server mode the collapsed persistence diagnostics remain
   available independently of build stamping.

## Acceptance criteria

- On a build with `VITE_CAPACITYLENS_BUILD_SHA=<sha>`, **Data and support → Build details** shows a muted one-line stamp
  `build <sha> · server` by default (same-origin server or a different origin configured with
  `VITE_CAPACITYLENS_API`), or `build <sha> · demo` when `VITE_CAPACITYLENS_DEMO=1` selects the
  in-memory build.
- On a build without the variable, server mode keeps the **Build details** row for its collapsed
  **Persistence diagnostics** disclosure. A demo build without the variable and without a feedback
  link omits the row.
- The stamp is plain text (no control, no link) and does not affect the axe audit.
- Server mode exposes a collapsed, keyboard-operable persistence diagnostics disclosure whose
  process-local counters reset with a fresh persistence attachment and contain no tenant values.
