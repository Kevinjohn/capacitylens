# US-NAV-03 — Wait for company data

As a company member, I want a loading state while company data is read so that incomplete data is not mistaken for an empty schedule.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Application content during initial load

**Documentation:** [Read The Schedule](../../docs-src/using/read-the-schedule.md)

**Source:** [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx)

## Acceptance criteria

- The page content area shows **Loading…** until the selected data source finishes loading, and again while a view as another member is starting or ending.

## User flow

```mermaid
flowchart TD
  human1["Open the application"]
  human2["Data is loading"]
  human3["Loading status remains visible"]
  human4["Hydration completes"]
  human5["requested page appears"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
  human4 --> human5
```

## Code flow

The planning read notice is a separate shell branch described in [US-NAV-04](US-NAV-04-persist-error-banner.md#code-flow).

```mermaid
flowchart TD
  auth["AuthProvider permits RouterProvider to render the company shell"] --> facts["AppShell passes current hydration and company facts to AppEntryGate"]
  auth --> effect["useCompanyAccessReady effect calls startData once ready"]
  effect --> state["startData marks the store hydrated; AppShell observes the change"]
  state --> facts
  facts --> gate{"AppEntryGate stage"}
  gate -->|hydration pending on this render| loading["LoadingGate fills the entry screen"]
  gate -->|ambiguous or missing required company| recovery["CompanyAccessRecovery renders"]
  gate -->|children allowed| main{"GatedMain: projection starting or ending?"}
  main -->|yes| loader["AppShellLoader delays the child route"]
  main -->|no| outlet["Suspense renders Outlet or AppShellLoader while lazy content loads"]
```

**Code references:** [AuthProvider.tsx:33](../../apps/frontend/src/auth/AuthProvider.tsx#L33) · [main.tsx:24](../../apps/frontend/src/main.tsx#L24) · [AppShell.tsx:214](../../apps/frontend/src/components/AppShell.tsx#L214) · [AppEntryGate.tsx:35](../../apps/frontend/src/components/AppEntryGate.tsx#L35) · [AppShell.tsx:151](../../apps/frontend/src/components/AppShell.tsx#L151)
