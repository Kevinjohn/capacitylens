# US-NAV-15 — Recognise action meaning and product identity

As a company member, I want consistent semantic colours so that I can recognise product, positive, and destructive actions.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Navigation and action buttons

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [button.tsx](../../apps/frontend/src/components/ui/button.tsx)

## Acceptance criteria

- Buttons share one semantic variant set: green for primary and confirming actions; neutral outline, secondary or ghost styles for secondary and cancel actions; red destructive or soft-danger styles for destructive actions; and the brand colour for link-styled actions.

## User flow

```mermaid
flowchart TD
  human1["Scan navigation and actions"]
  human2["Positive, neutral, destructive or link intent is conveyed"]
  human3["Text and controls remain legible"]
  human1 --> human2
  human2 --> human3
```

## Code flow

```mermaid
flowchart TD
  action["Button receives a variant"] --> styles["buttonVariants selects semantic utility classes"]
  styles --> tokens["index.css supplies semantic colour tokens"]
  tokens --> ui["Button applies the selected variant, including default, danger-soft and destructive"]
  header["SidebarHeaderContent renders APP_NAME"] --> brand["Brand row supplies data-visual-intent brand"]
  menu["NavMenu computes active destination"] --> nav["SidebarMenuButton supplies data-active for navigation styling"]
```

**Code references:** [button.tsx:15](../../apps/frontend/src/components/ui/button.tsx#L15) · [AppSidebar.tsx:84](../../apps/frontend/src/components/AppSidebar.tsx#L84) · [AppSidebar.tsx:189](../../apps/frontend/src/components/AppSidebar.tsx#L189) · [sidebar.tsx:641](../../apps/frontend/src/components/ui/sidebar.tsx#L641) · [index.css:1](../../apps/frontend/src/index.css#L1)
