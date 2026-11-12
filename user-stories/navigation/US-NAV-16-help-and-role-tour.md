# US-NAV-16 — Find help and a role-based tour

As a company member, I want help and guidance suited to my role so that I can learn relevant controls.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Help sidebar link; Help view tour control

**Documentation:** [Help](../../docs-src/using/help.md); [Roles And Permissions](../../docs-src/getting-started/roles-and-permissions.md)

**Source:** [HelpView.tsx](../../apps/frontend/src/components/HelpView.tsx); [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx)

## Acceptance criteria

- The sidebar **Help** link opens Help, which offers **Show tour** and a **Browse the user guides** link. **Show tour** opens the Schedule and steps through guidance for the active role; it is disabled until the role is known.

## User flow

```mermaid
flowchart TD
  human1["Open Help from navigation"]
  human2["Read help entry"]
  human3["Select Show tour"]
  human4["Role-based schedule tour begins"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  nav["AppSidebar renders HELP_LINK"] --> route["router renders HelpView at help route"]
  help["HelpView calls useTourAction"] --> action["useTourAction checks permission readiness"]
  action --> start["startTour builds role tour and navigates"]
  start --> guide["driver.js presents tour steps"]
```

**Code references:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [navLinks.ts](../../apps/frontend/src/lib/navLinks.ts); [router.tsx](../../apps/frontend/src/router.tsx); [HelpView.tsx](../../apps/frontend/src/components/HelpView.tsx); [useTourAction.ts](../../apps/frontend/src/hooks/useTourAction.ts); [tour.ts](../../apps/frontend/src/lib/tour.ts); [tourSteps.ts](../../apps/frontend/src/lib/tourSteps.ts)
