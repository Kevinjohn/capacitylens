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
  route["Help link opens HelpView"] --> tour["HelpView reads useTourOperation"]
  tour --> availability{"Permission resolved or not applicable, and no tour in flight?"}
  availability -->|no| disabled["Show tour control stays disabled"]
  availability -->|yes and selected| start["showTour marks busy and calls startTour with current role"]
  start --> run["Reuse an active tour or runTour navigates to Schedule before importing driver.js"]
  run -->|launch| driver["driver renders steps from buildRoleTour"]
  driver --> destroyed["Tour closes and driver-active clears; startTour resolves"]
  run -->|rejection| notice["showTour sets an error notice"]
  destroyed --> release["finally clears the in-flight flag and busy state"]
  notice --> release
  route --> orientation["Orientation button calls Outlet context showOrientation"]
  route --> guides["User guides link opens the documentation"]
  route -->|diagnostics decision allowed| diag["HelpView renders Diagnostics link"]
```

**Code references:** [HelpView.tsx:15](../../apps/frontend/src/components/HelpView.tsx#L15) · [useTourOperation.ts:8](../../apps/frontend/src/hooks/useTourOperation.ts#L8) · [tour.ts:70](../../apps/frontend/src/lib/tour.ts#L70) · [router.tsx:199](../../apps/frontend/src/router.tsx#L199)
