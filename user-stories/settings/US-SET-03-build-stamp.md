# US-SET-03 — Report which build I'm on (build stamp)

**Area:** Settings · **Persona:** Tester on the hosted demo · **Linked E2E:** `e2e/settings-build-stamp.spec.ts` → "no build stamp in the default dev build"

> **Flag-gated:** the stamp only exists in builds made with `VITE_CAPACITYLENS_BUILD_SHA` set
> (the deploy script does this). A build with no stamp and no feedback link omits the **Build
> details** row.

**Documentation:** [Settings](../../docs-src/guide/settings.md)

## Goal

Tell the team exactly which build and backend mode a bug report is about, by reading
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

**Precondition (default local build):** run `pnpm run dev`, open Settings.

4. Confirm there is **no** build stamp and no **Build details** row.

## Acceptance criteria

- On a build with `VITE_CAPACITYLENS_BUILD_SHA=<sha>`, **Data and support → Build details** shows a muted one-line stamp
  `build <sha> · server` by default (same-origin server or a different origin configured with
  `VITE_CAPACITYLENS_API`), or `build <sha> · demo` when `VITE_CAPACITYLENS_DEMO=1` selects the
  in-memory build.
- On a build without the variable and without a feedback link, the **Build details** row is absent
  in both server and demo mode. Settings shows no persistence diagnostics.
- The stamp is plain text (no control, no link) and does not affect the axe audit.
