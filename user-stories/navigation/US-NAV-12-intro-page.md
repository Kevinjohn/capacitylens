# US-NAV-12 — Post-login "What CapacityLens is" intro page (once per device)

**Area:** Navigation & shell · **Persona:** New viewer landing in CapacityLens for the first time · **Linked E2E:** `e2e/fake-signin.spec.ts` → "precedes the company picker; signing in reveals it, then the app" (asserts the intro shows after the company pick, axe-clean, and Continue reveals the app); `e2e/login.auth.spec.ts` → "signing in reveals the app…" (the same intro fires on the real-auth path)

> **Placeholder copy.** The wording on this page is **placeholder**, pending a human edit — it is
> single-sourced in `src/lib/introCopy.ts` and rendered verbatim. Don't treat the exact sentences as
> final product positioning; the *behaviour* (a once-per-device explainer between picking a company
> and the app) is what this story pins.

## Goal
After choosing a company, a first-time viewer sees a brief page explaining what CapacityLens is — a
resourcing tool, not a project-management tool — so they arrive at the schedule with the right mental
model, then continue into the app.

## Why
CapacityLens is deliberately narrow (a helicopter view of who's busy/free). New viewers often expect a
task/ticket tracker. A short intermediary page sets that expectation up front. It shows once per
device so it never nags returning users.

## How (end-to-end, default local mode)
**Precondition:** Seeded app in the default deploy. Start from a clean state (DevTools → Console →
`localStorage.clear()` → reload).

1. Open the app, click through the demo sign-in (US-NAV-11), and pick **Studio North**.
2. Instead of the schedule, the **Welcome to CapacityLens** page appears: a centred card explaining CapacityLens
   is a **resourcing tool** (bold) and **not a project management tool** (bold), with a single
   **Continue** button. The company picker and the app nav are not present behind it.
3. Click **Continue** → the scheduler loads as normal.
4. Reload the tab (and re-pick the company if prompted) → you go **straight to the app**; the intro
   does not reappear (it is dismissed per-browser).

## Acceptance criteria
- After a company is chosen — on a clean load — the **Welcome to CapacityLens** page appears **before** the
  app, with exactly one `h1`, the placeholder paragraphs, and a **Continue** button
  (`data-testid="intro-continue"`).
- The page renders in **every** entry mode that reaches a chosen account: the no-auth default, the
  cosmetic demo sign-in (US-NAV-11), and the real auth wall (US-NAV-10).
- Clicking **Continue** dismisses the intro and reveals the app (the **Schedule** link is visible).
- The dismissal **persists across reload** (`capacitylens/introSeen`) — the intro shows once per device and
  is skipped thereafter; it is never written to `AppData`/export.
- The intro page passes an axe accessibility audit (no serious/critical violations), with one `h1`
  and a focusable Continue button.
