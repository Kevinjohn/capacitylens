# US-NAV-13 — Reach a useful first schedule through three outcomes

**Area:** Navigation & shell · **Persona:** New Owner, Admin or Editor setting up a company · **Linked coverage:** `e2e/getting-started.spec.ts`, `e2e/members.auth.spec.ts`, `e2e/viewer.auth.spec.ts`, `src/components/GettingStarted.test.tsx`, `src/lib/gettingStarted.test.ts`

**Documentation:** [Make your first schedule useful](../../docs-src/getting-started/first-steps.md)

## Goal

Turn an empty company into a useful schedule by completing three observable outcomes: add someone
to schedule, add work to schedule, and schedule the first piece of work.

## Why

An empty schedule explains very little. Outcome-based guidance keeps the route short and remains
accurate when records arrive in a different order or through import. It avoids making client setup,
Settings, invitations or the tour mandatory for a solo team or internal work.

## How (end-to-end, default local mode)

**Precondition:** Start from a clean device state and create a new, empty company.

1. The Schedule remains visible with a floating **Getting started** card over the grid. The
   non-blocking **How CapacityLens works** region may also appear above the page (US-NAV-12).
2. Choose **Set up manually**. Focus moves to **Add someone to the schedule**. Follow it to
   **Resources**, add a person, then return to Schedule: the first outcome is marked done.
3. Add an **Internal** or **All projects** activity. Return to Schedule: **Add work to schedule**
   is marked done. Internal work needs no client or project. An All-projects booking may be left
   unattributed or attributed only to an active project with an active client. Project-specific
   work must belong to a valid active client and project.
4. Click or drag on the person's schedule row and save the allocation. The third outcome completes
   and the card closes automatically.
5. In another empty Owner company, choose **Import CapacityLens data**. Settings opens at Import,
   but merely following the link completes nothing. After a successful import, only the outcomes
   represented by coherent imported records are marked done.
6. Confirm **Review Settings**, **Invite your team** and **Show me around** remain available as
   supporting actions. They are optional and do not affect the three-outcome progress.

## Acceptance criteria

- The card (`data-testid="getting-started"`) appears over Schedule only while at least one outcome
  is incomplete and it has not been dismissed on this device. It does not move the toolbar or grid.
- Outcomes derive from active, coherent company data. A person must be schedulable; work may be an
  internal activity, an All-projects activity, or a project activity with its active client and
  project; an allocation must join an active person and coherent activity. A zero-hour allocation
  still counts.
- **Set up manually** reveals the outcomes and moves focus to the first incomplete one. Background
  data changes do not steal focus.
- Choosing import opens the Import section but does not itself count as progress. Imported data
  satisfies only the outcomes it actually contains.
- Only an Owner, or an open/demo deployment, sees the whole-company import action. Owner and Admin
  see the optional Team & access link; Editor sees neither import nor the access link. Viewer sees
  no setup guidance because every outcome needs write access.
- Completed outcomes show a check, strike-through and screen-reader **Done:** prefix. Other pages
  show a compact **Getting started: N of 3 complete** link back to Schedule.
- **Show me around** (`data-testid="getting-started-tour"`) runs the five-stop schedule tour without
  navigating. Next, Back, Done and Escape work, and spotlighted controls remain inert.
- **Dismiss** (`data-testid="getting-started-dismiss"`) hides the card and persists the device-wide
  `capacitylens/gettingStartedDismissed` preference. It is never company data or exported data.
