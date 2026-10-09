# US-NAV-13 — Track five first-schedule milestones

**Area:** Navigation & shell · **Persona:** New Owner, Admin or Editor setting up a company · **Linked coverage:** `e2e/getting-started.spec.ts`, `e2e/getting-started.db.spec.ts`, `e2e/members.auth.spec.ts`, `e2e/viewer.auth.spec.ts`, `src/components/GettingStarted.test.tsx`, `src/lib/gettingStarted.test.ts`, `src/lib/tourSteps.test.ts`

**Documentation:** [Make your first schedule useful](../../docs-src/getting-started/quick-start.md#make-your-first-schedule-useful)

## Goal

See company setup progress on every page, complete five observable milestones, and learn the schedule
and company areas that fit the caller's role.

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
5. **Show me around** on Getting started starts on Schedule and presents the caller's role section followed by lower
   role sections. Owners see eight server-backed stops, Admins seven and Editors five. Each role
   section begins with its role name, and the read-only Viewer section closes the tour. The in-memory
   demo omits the server-only example-data stop. Starting away from Schedule returns there first.
   Pending or unavailable permissions and read-only offline snapshots disable the launcher; a
   running tour cannot be started twice. Viewers see neither the Getting started bar nor its tour
   launcher. Every role can open Help from the sidebar to start its role-based tour, including after
   Getting started is dismissed.

## Acceptance criteria

- Only active, coherent company records count. The built-in client does not complete the client
  milestone; a project must belong to an active non-built-in client. Project Activity ancestry and
  allocation references remain validated. A zero-hour allocation counts.
- The progress bar has an accessible 0–5 value. Card visibility is an independent temporary choice.
  The expanded card moves schedule content below it so it does not cover page controls.
- Owner and Admin can dismiss company-wide. Editor can view and toggle the card. Viewer sees neither
  card nor bar. The server enforces the permanent-dismiss permission.
- **Show me around** (`data-testid="getting-started-tour"`) follows the current permission role and
  lower roles, with eight server-backed Owner stops, seven Admin stops and five Editor stops. The
  Viewer section closes those tours with two read-only stops; Viewers have no Getting started
  launcher. The demo omits only the server example-data stop. It returns to Schedule when needed.
- Help (`/help`) is available to every role above Account in the sidebar. Its Show tour button
  uses the same permission, offline, in-progress and failure behavior as the Getting started action.
- The launcher is disabled while permission status is pending or unavailable, or when the app is
  showing a read-only offline snapshot. A tour failure surfaces an error and leaves the card usable.
