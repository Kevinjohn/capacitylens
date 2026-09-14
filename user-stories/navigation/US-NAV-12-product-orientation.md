# US-NAV-12 — Reopen a concise explanation of how CapacityLens works

**Area:** Navigation & shell · **Persona:** Anyone entering a company or the personal Account page · **Linked coverage:** `src/components/ProductOrientation.test.tsx`, `src/components/AppShell.productOrientation.test.tsx`, `src/lib/productOrientation.test.ts`, `e2e/fake-signin.spec.ts`

**Documentation:** [Make your first schedule useful](../../docs-src/getting-started/first-steps.md#understand-what-capacitylens-plans)

**Sources:** `src/components/ProductOrientation.tsx`, `src/components/useProductOrientation.ts`,
`src/lib/productOrientation.ts`, `src/components/AppShell.tsx`, `src/components/AppSidebar.tsx`

## Goal

Understand the schedule's basic language and CapacityLens's boundary without being blocked from
the application, then reopen that explanation whenever it is useful.

## Why

CapacityLens is deliberately a week-by-week capacity planner, not a task or deadline tracker. A
short explanation beside the application gives a new person that mental model while leaving the
schedule, navigation and account recovery paths usable.

## How (end-to-end, default local mode)

**Precondition:** Start from a clean browser profile or remove the current product-orientation
dismissal keys from local storage.

1. Open CapacityLens, complete the demo sign-in if it appears, and choose **Wayne Enterprises**.
2. The application opens normally. A region headed **How CapacityLens works** appears above the
   page and explains the week-by-week view, rows and scheduled work, and the product boundary.
   The Schedule link and page remain available while it is visible.
3. Click **Got it**. The region closes without changing page.
4. Reload and choose the same company. The explanation stays closed for this person, company and
   device.
5. Choose **How CapacityLens works** in the sidebar. The region opens and its heading receives
   focus. Click **Got it** and focus returns to the sidebar action.
6. Repeat from the personal **Account** page with no active company. The same explanation remains
   available and its dismissal is stored independently from company dismissals.

## Acceptance criteria

- The guidance is a labelled, non-modal region (`data-testid="product-orientation"`), not a page,
  dialog or route gate. It never hides the application shell.
- It plainly explains that people are rows, scheduled work spans their days, clients, projects
  and activities identify the work, and CapacityLens does not manage tasks, tickets or deadlines.
- The region is available to every role and in the no-company personal Account state.
- **Got it** dismisses it for the current person and company on this device. Dismissal uses the
  versioned `capacitylens/productOrientation/v1/<subject>/<company>` preference and is never part
  of company data or an export. The no-company state has its own stable scope.
- A storage failure does not block the application: the region stays dismissed for the current
  mount and can return on a later load.
- **How CapacityLens works** remains a permanent sidebar action. It opens the region, scrolls to
  and focuses the heading, works in the collapsed keyboard-accessible sidebar, and closes the
  mobile sidebar before moving focus.
- Dismissing a manually reopened region returns focus to its trigger. Automatic background state
  changes do not steal focus repeatedly.
