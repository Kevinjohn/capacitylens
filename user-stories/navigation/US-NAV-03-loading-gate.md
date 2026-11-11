# US-NAV-03 — Wait for company data

As a company member, I want a loading state while company data is read so that incomplete data is not mistaken for an empty schedule.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Application content during initial load

**Documentation:** [Read The Schedule](../../docs-src/using/read-the-schedule.md)

**Source:** [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx)

## Acceptance criteria

- The page content area shows **Loading…** until the selected data source finishes loading, and again while a member view is starting or ending.

## User flow

```mermaid
flowchart TD
  human1["Open the application"]
  human2["Data is loading"]
  human3["Loading status remains visible"]
  human4["Hydration completes"]
  human5["requested page appears"]
  human6["Connection or local-data error"]
  human7["matching recovery screen"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
  human4 --> human5
  human1 --> human6
  human6 --> human7
```

## Code flow

```mermaid
flowchart TD
  store["useStore hydration and error state"] --> shell["AppShell passes gate state"]
  shell --> gate["AppEntryGate selects entry stage"]
  gate -->|not hydrated| loading["LoadingBoundary status"]
  gate -->|ready| children["Application children render"]
  gate -->|error| recovery["ConnectionError or StorageRecovery"]
```

**Code references:** [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx); [AppEntryGate.tsx](../../apps/frontend/src/components/AppEntryGate.tsx); [runtimeSlice.ts](../../apps/frontend/src/store/slices/runtimeSlice.ts)
