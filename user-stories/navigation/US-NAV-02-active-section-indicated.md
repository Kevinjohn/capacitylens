# US-NAV-02 — See the active section

As a company member, I want the current section identified in navigation so that I know where I am.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Current sidebar route link

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx)

## Acceptance criteria

- The current destination is marked as current; the root Schedule link matches only the root route.

## User flow

```mermaid
flowchart TD
  human1["Open a section"]
  human2["Its sidebar link is marked current"]
  human3["Open another section"]
  human4["Current marker moves to that link"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  loc["useLocation reads pathname"] --> menu["NavMenu maps links"]
  menu --> nav["NavLink computes aria-current and active style"]
  nav --> root["end=true for Schedule root route"]
```

**Code references:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [navLinks.ts](../../apps/frontend/src/lib/navLinks.ts)
