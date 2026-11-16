# US-NAV-16 — Find help and a role-based tour

As a company member, I want help and guidance suited to my role so that I can learn relevant controls.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Help sidebar link; Help view tour, orientation and Diagnostics controls

**Documentation:** [Help](../../docs-src/using/help.md); [Roles And Permissions](../../docs-src/getting-started/roles-and-permissions.md)

**Source:** [HelpView.tsx](../../apps/frontend/src/components/HelpView.tsx); [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx)

## Acceptance criteria

- The sidebar **Help** link opens Help, which offers **Show tour**, a **How CapacityLens works** button and a **Browse the user guides** link. **Show tour** opens the Schedule and steps through guidance for the active role; it is disabled until the role is known. **How CapacityLens works** reopens the product orientation. Owners and Admins also see a **Diagnostics** link with a line saying what it is for; Editors and Viewers do not.

## User flow

```mermaid
flowchart TD
  human1["Open Help from navigation"]
  human2["Read help entry"]
  human3["Select Show tour"]
  human4["Role-based schedule tour begins"]
  human5["Select How CapacityLens works"]
  human6["Product orientation reopens"]
  human7["Owner or Admin selects Diagnostics"]
  human8["Diagnostics opens"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
  human2 --> human5
  human5 --> human6
  human2 --> human7
  human7 --> human8
```

## Code flow

```mermaid
flowchart TD
  nav["AppSidebar renders HELP_LINK"] --> route["router renders HelpView at help route"]
  help["HelpView calls useTourAction"] --> action["useTourAction checks permission readiness"]
  action --> start["startTour builds role tour and navigates"]
  start --> guide["driver.js presents tour steps"]
  help --> orient["button calls showOrientation from Outlet context"]
  help --> diag["useDiagnosticsAccessDecision allowed renders Diagnostics link"]
```

**Code references:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [navLinks.ts](../../apps/frontend/src/lib/navLinks.ts); [router.tsx](../../apps/frontend/src/router.tsx); [HelpView.tsx](../../apps/frontend/src/components/HelpView.tsx); [useDiagnosticsAccessDecision.ts](../../apps/frontend/src/components/diagnostics/useDiagnosticsAccessDecision.ts); [useTourAction.ts](../../apps/frontend/src/hooks/useTourAction.ts); [tour.ts](../../apps/frontend/src/lib/tour.ts); [tourSteps.ts](../../apps/frontend/src/lib/tourSteps.ts)
