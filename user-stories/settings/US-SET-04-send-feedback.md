# US-SET-04 — Send feedback pinned to the build I'm on

**Area:** Settings · **Persona:** Tester on the hosted demo · **Linked E2E:** `e2e/settings-build-stamp.spec.ts` → "no Send feedback link in the default dev build"

> **Flag-gated:** the link only exists in builds made with `VITE_CAPACITYLENS_FEEDBACK_MAILTO`
> set (the deploy script sets it to the owner's address). The default dev/local build
> renders nothing, so the only part runnable against `npm run dev` is the *absence*
> check — which is what the linked E2E asserts. Pairs with [US-SET-03](US-SET-03-build-stamp.md).

## Goal
Report a problem in one click, with the email already pinned to the exact build it
happened on.

## Why
Tester reports arrive by email this round (no Sentry — Phase 0 decision). A bare "it
broke" mail costs a round-trip to ask *which build*; pre-filling the subject with the
build stamp (`CapacityLens feedback — build a1b2c3d · server`) makes every report attributable
on arrival.

## How (end-to-end, hosted demo)
**Precondition:** the deployed site, signed in past Basic Auth; click **Settings**.

1. Scroll to the footer below **Appearance**: next to the build stamp sits a
   **Send feedback** link (`data-testid="send-feedback"`).
2. Click it — the mail client opens a draft to the owner's address with the subject
   `CapacityLens feedback — build <sha> · server`.
3. Describe the problem and send.

**Precondition (default local build):** run `npm run dev`, open Settings.

4. Confirm there is **no** Send feedback link (and no footer at all).

## Acceptance criteria
- With `VITE_CAPACITYLENS_FEEDBACK_MAILTO=<addr>` baked into the build, Settings shows a
  **Send feedback** `mailto:` link beside the build stamp.
- The mailto subject contains the build stamp when `VITE_CAPACITYLENS_BUILD_SHA` is also set
  (the demo deploy sets both), and a plain `CapacityLens feedback` subject otherwise.
- Without the variable (dev server, plain `npm run build`), the link is absent —
  today's Settings, unchanged.
- The link is plain text-styled, keyboard-focusable, and does not affect the axe audit.
