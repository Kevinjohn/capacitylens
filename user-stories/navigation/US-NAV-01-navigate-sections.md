# US-NAV-01 — Navigate permitted sections

As an Owner, Admin, Editor, or Viewer, I want to open the sections available to my role so that I can reach my company work.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer; section visibility and write controls follow role permissions.

**Entry:** Sidebar links; direct route; command palette

**Documentation:** [Settings](../../docs-src/using/settings.md)

**Source:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx)

## Acceptance criteria

- Selecting a permitted destination renders its page and preserves valid deep links; unknown routes show the not-found page. A direct link to Overview or Diagnostics without access, or to Disciplines while disciplines are off, returns to the Schedule. The sidebar lists the working destinations, **Team & access** and **Settings**, then **Help** and **Account**; Diagnostics is reached from Help or the command palette, not the sidebar.

## User flow

```mermaid
flowchart TD
  human1["Start at any valid application URL"]
  human2["Choose a permitted sidebar destination, or Diagnostics from Help"]
  human3["Destination page opens"]
  human4["Direct link or reload"]
  human5["requested page opens"]
  human1 --> human2
  human2 --> human3
  human1 --> human4
  human4 --> human5
```

## Code flow

This trace starts after authentication. See [US-NAV-18](US-NAV-18-not-found-route.md#code-flow) for the signed-out and unmatched URL paths.

```mermaid
flowchart TD
  facts["useVisibleRoutes reads role, permission status and company settings"] --> visible["listVisibleRoutes filters the route catalogue"]
  visible --> nav["GatedSidebar renders navigation links; CommandPalette receives the same visible routes"]
  nav --> match["Link selection matches a router route"]
  direct["Direct URL or bookmark"] --> match
  match -->|ordinary child| child["AppShell Outlet renders the child"]
  match -->|Overview or Diagnostics| perm{"Checking, allowed or denied?"}
  perm -->|checking| progress["Route loading status"]
  perm -->|allowed| child
  perm -->|denied| schedule["Navigate replaces URL with Schedule"]
  match -->|Disciplines| flag{"Disciplines enabled?"}
  flag -->|yes| child
  flag -->|no| schedule
  match -->|unmatched| missing["Top-level NotFound after the outer auth gate"]
```

**Code references:** [useVisibleRoutes.ts:37](../../apps/frontend/src/components/useVisibleRoutes.ts#L37) · [navLinks.ts:173](../../apps/frontend/src/lib/navLinks.ts#L173) · [AppShell.tsx:132](../../apps/frontend/src/components/AppShell.tsx#L132) · [CommandPalette.tsx:49](../../apps/frontend/src/components/CommandPalette.tsx#L49) · [router.tsx:113](../../apps/frontend/src/router.tsx#L113) · [router.tsx:238](../../apps/frontend/src/router.tsx#L238)
