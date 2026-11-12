# US-KBD-04 — Keep key screens accessible

As an accessibility reviewer, I want key schedule and form screens checked against WCAG criteria so that serious barriers are detected.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Schedule in light/dark appearance; Resource form dialog

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [a11y.spec.ts](../../e2e/a11y.spec.ts)

## Acceptance criteria

- Automated axe checks report no serious or critical WCAG 2.1 A/AA violations on the covered screens.

## User flow

```mermaid
flowchart TD
  human1["Accessibility audit check, not a product interaction:"]
  human2["Run the axe check for schedule light, schedule dark, and Resource dialog"]
  human3["Inspect serious/critical WCAG 2.1 A/AA violations"]
  human4["Report the check result"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  spec["e2e/a11y.spec.ts audit cases"] --> render["Playwright opens schedule or Resource dialog"]
  render --> axe["AxeBuilder scans rendered DOM with WCAG tags"]
  axe --> assert["test asserts no serious or critical violations"]
  ui["AppShell and scheduler render product UI"] -. audited by .-> render
```

**Code references:** [a11y.spec.ts](../../e2e/a11y.spec.ts); [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx); [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx); [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx)
