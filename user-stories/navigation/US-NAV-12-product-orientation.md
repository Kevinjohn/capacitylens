# US-NAV-12 — Understand the product at entry

As a company member, I want concise product guidance when I enter so that I can understand the schedule without being blocked.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Automatically shown orientation; Help → How CapacityLens works

**Documentation:** [What Is Capacitylens](../../docs-src/getting-started/what-is-capacitylens.md)

**Source:** [ProductOrientation.tsx](../../apps/frontend/src/components/ProductOrientation.tsx); [useProductOrientation.ts](../../apps/frontend/src/components/useProductOrientation.ts); [HelpView.tsx](../../apps/frontend/src/components/HelpView.tsx)

## Acceptance criteria

- Eligible users see non-blocking guidance until dismissed; dismissal is a scoped device preference and the **How CapacityLens works** button on Help reopens it.

## User flow

```mermaid
flowchart TD
  human1["Enter an eligible company or Account page"]
  human2["Product orientation appears without blocking"]
  human3["Dismiss it"]
  human4["Help → How CapacityLens works reopens it"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  app["AppShell calls useProductOrientation"] --> subject["resolveProductOrientationSubject scopes identity and company"]
  subject --> pref["hasDismissedProductOrientation reads device preference"]
  pref --> view["ProductOrientation renders guidance"]
  click["HelpView How CapacityLens works button"] --> ctx["AppShell Outlet context showOrientation"] --> reopen["orientation.show focuses guidance"]
  view --> dismiss["orientation.dismiss stores scoped preference"]
```

**Code references:** [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx); [useProductOrientation.ts](../../apps/frontend/src/components/useProductOrientation.ts); [ProductOrientation.tsx](../../apps/frontend/src/components/ProductOrientation.tsx); [productOrientation.ts](../../apps/frontend/src/lib/productOrientation.ts); [HelpView.tsx](../../apps/frontend/src/components/HelpView.tsx)
