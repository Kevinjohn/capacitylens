# US-NAV-13 — Track five first-schedule milestones

**Area:** Navigation & shell · **Persona:** New Owner, Admin or Editor setting up a company · **Linked coverage:** `e2e/getting-started.spec.ts`, `e2e/members.auth.spec.ts`, `e2e/viewer.auth.spec.ts`, `src/components/GettingStarted.test.tsx`, `src/lib/gettingStarted.test.ts`

**Documentation:** [Make your first schedule useful](../../docs-src/getting-started/first-steps.md)

## Goal

See company setup progress on every page and complete five observable milestones: add a person,
client, project, Activity and first allocation.

## Why

An empty schedule needs a short, shared path to useful data. Live milestones make progress visible
when teammates add records in different orders or import them, while company-wide dismissal lets
an Owner or Admin retire the guidance once it is no longer useful.

## How

1. In an empty company, the Schedule opens with the five-row **Getting started** card. The top bar
   reads 0/5 and remains visible across application pages, including Settings.
2. Follow each checklist link to add a person, client, project belonging to that client, Activity
   and allocation joining valid active records. Each step completes independently from company data,
   including imported records. Internal work remains available, but it does not skip the client or
   project milestones.
3. Show or hide the card from the bar. On other pages and at 5/5, the card starts closed. The 5/5
   bar remains until an Owner or Admin dismisses it.
4. If setup is incomplete, an Owner or Admin's **Dismiss** action asks **Do you really want to hide
   this forever?** No changes nothing. Yes hides both card and bar for everyone in this company,
   across devices. Another company keeps its own state. A failed save leaves guidance available.

## Acceptance criteria

- Only active, coherent company records count. The built-in client does not complete the client
  milestone; a project must belong to an active non-built-in client. Project Activity ancestry and
  allocation references remain validated. A zero-hour allocation counts.
- The progress bar has an accessible 0–5 value. Card visibility is an independent temporary choice.
  The expanded card moves schedule content below it so it does not cover page controls.
- Owner and Admin can dismiss company-wide. Editor can view and toggle the card. Viewer sees neither
  card nor bar. The server enforces the permanent-dismiss permission.
- **Show me around** (`data-testid="getting-started-tour"`) runs the five-stop schedule tour without
  navigation. If it fails, the card remains usable and surfaces an error.
