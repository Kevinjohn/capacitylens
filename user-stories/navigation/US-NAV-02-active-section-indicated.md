# US-NAV-02 — See the active section

As a company member, I want the current section identified in navigation so that I know where I am.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Current sidebar route link

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx)

## Acceptance criteria

- The current destination is marked as current; the root Schedule link matches only the root route. The **Help** row is current on `/diagnostics` as well as `/help`, because Diagnostics is reached from Help.

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
  loc["AppSidebar reads useLocation pathname"] --> menu["NavMenu calculates matchPath for each destination"]
  menu --> root["Schedule uses exact matching for matchPath and NavLink end"]
  menu --> other["Other listed routes use their destination match"]
  root --> paint["SidebarMenuButton isActive sets data-active for styling"]
  other --> paint
  loc --> help["HelpMenuItem tests Help or Diagnostics"]
  help --> paint
  help --> semantics["Help NavLink still points to /help and owns its link semantics"]
```

**Code references:** [AppSidebar.tsx:36](../../apps/frontend/src/components/AppSidebar.tsx#L36) · [AppSidebar.tsx:156](../../apps/frontend/src/components/AppSidebar.tsx#L156) · [AppSidebar.tsx:189](../../apps/frontend/src/components/AppSidebar.tsx#L189) · [sidebar.tsx:641](../../apps/frontend/src/components/ui/sidebar.tsx#L641)
