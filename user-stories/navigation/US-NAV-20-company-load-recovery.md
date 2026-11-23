# US-NAV-20 — Recover when the active company fails to load

As a company member, I want to retry loading the active company so that I can continue if its planning data becomes available.

**Status:** Removed — the company-load recovery screen had no producer and was deleted; a failed planning read shows the shell's planning alert.

**Access:** Owner, Admin, Editor, Viewer.

**Entry:** None.

**Documentation:** [When something goes wrong](../../docs-src/self-hosting/incidents.md)

**Source:** [router.tsx](../../apps/frontend/src/router.tsx); [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx); [planningNotices.ts](../../apps/frontend/src/data/planning/planningNotices.ts)

## Acceptance criteria

- No separate recovery screen exists; a failed planning read is shown by the shell's planning alert.

## User flow

Unavailable: the screen was removed.

```mermaid
flowchart TD
A["Planning read fails"] --> B["Shell shows the planning alert"]
```

## Code flow

The dedicated company-load recovery screen was removed. See [US-NAV-04](US-NAV-04-persist-error-banner.md#code-flow) for the current notice paths.

```mermaid
flowchart TD
  read["Planning cache refresh receives a read failure"] --> scope{"Authentication scope lost?"}
  scope -->|401| clear["loseScope clears planning state"]
  scope -->|other current failure| problem["readPlanningProblem classifies the recorded error"]
  problem -->|403| refused["GatedMain renders refusal Alert"]
  problem -->|other failed read| unavailable["GatedMain renders unavailable Alert"]
```

**Code references:** [planningCache.ts:304](../../apps/frontend/src/data/planning/planningCache.ts#L304) · [planningNotices.ts:11](../../apps/frontend/src/data/planning/planningNotices.ts#L11) · [AppShell.tsx:163](../../apps/frontend/src/components/AppShell.tsx#L163) · [AppEntryGate.tsx:43](../../apps/frontend/src/components/AppEntryGate.tsx#L43)
