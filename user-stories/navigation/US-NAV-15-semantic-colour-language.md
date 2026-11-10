# US-NAV-15 — Recognize action meaning and product identity

As a company member, I want consistent semantic colours so that I can recognize product, positive, and destructive actions.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Navigation and action buttons

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [button.tsx](../../apps/frontend/src/components/ui/button.tsx)

## Acceptance criteria

- Brand, positive, neutral, warning, and destructive actions use consistent high-contrast semantic styling.

## User flow

```mermaid
flowchart TD
  human1["Scan navigation and actions"]
  human2["Brand, positive, neutral, warning, or destructive intent is conveyed"]
  human3["Text and controls remain legible"]
  human1 --> human2
  human2 --> human3
```

## Code flow

```mermaid
flowchart TD
  action["Button receives variant and visual intent"] --> styles["button.tsx assigns semantic classes"]
  styles --> tokens["index.css resolves semantic color tokens"]
  tokens --> ui["rendered control communicates intent"]
```

**Code references:** [button.tsx](../../apps/frontend/src/components/ui/button.tsx); [index.css](../../apps/frontend/src/index.css)
