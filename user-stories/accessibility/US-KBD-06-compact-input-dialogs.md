# US-KBD-06 — Scan management forms at different widths

As a company member, I want labelled form controls to remain clear on desktop and narrow screens so that I can complete supported forms.

**Status:** Current

**Access:** Owner, Admin, Editor; visibility and writes are role-gated

**Entry:** Resource, External party, Discipline, Client, Project, Activity, and Time off forms

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [dialog-layout.spec.ts](../../e2e/dialog-layout.db.spec.ts)

## Acceptance criteria

- Fields use aligned labels at wider widths and stacked labels on narrow screens; required and conditional fields remain associated.

## User flow

```mermaid
flowchart TD
  human1["Open a supported management form"]
  human2["Labels and controls align at wider widths"]
  human3["Narrow viewport"]
  human4["labels stack above controls"]
  human5["Conditional and required fields remain labelled"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
  human4 --> human5
```

## Code flow

Resource is the layout reference. The comparison tests exercise Client, Project, Activity, External party, Discipline and Time off forms.

```mermaid
flowchart TD
  form["A management form renders a shared field with label-control layout"] --> layout["buildProductFieldLayoutProps adds the compact marker and responsive classes"]
  layout --> width{"At the small breakpoint or wider?"}
  width -->|yes| columns["Render label and control in a one-to-three grid"]
  width -->|no| stacked["Render the same label and control in stacked order"]
  columns --> labels["TextField keeps the same htmlFor and input ID"]
  stacked --> labels
```

**Code references:** [buildProductFieldLayoutProps.ts:4](../../apps/frontend/src/components/common/fields/buildProductFieldLayoutProps.ts#L4) · [textFields.tsx:95](../../apps/frontend/src/components/common/fields/textFields.tsx#L95) · [dialog-layout.db.spec.ts:33](../../e2e/dialog-layout.db.spec.ts#L33) · [dialog-layout.db.spec.ts:65](../../e2e/dialog-layout.db.spec.ts#L65) · [dialog-layout.db.spec.ts:124](../../e2e/dialog-layout.db.spec.ts#L124)
