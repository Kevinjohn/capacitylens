# US-NAV-04 — See planning read and save failures

As a company member, I want failed or uncertain server operations shown clearly so that I can make an informed recovery decision.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Schedule planning read/write failure → visible error notice

**Documentation:** [Incidents](../../docs-src/self-hosting/incidents.md)

**Source:** [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx); [planningCache.ts](../../apps/frontend/src/data/planning/planningCache.ts)

## Acceptance criteria

- A failed planning read shows **The schedule couldn’t be loaded from the server. Reload to try again.**, blocks planning changes and stays until a later read succeeds.
- A change the server refuses with 403 shows **That schedule change was refused, so it wasn’t saved.**; the loaded rows stay readable.
- While an earlier change’s outcome is still unconfirmed, further changes are refused. Neither banner has a Retry control.

## User flow

```mermaid
flowchart TD
  read["Planning read fails"] --> banner["Unavailable banner appears; changes are blocked"]
  banner -->|a later read succeeds| current["Current planning data appears"]
  refused["Server refuses a change (403)"] --> refusedBanner["Refused banner appears; rows stay readable"]
  banner --> noRetry["Neither banner has a Retry control"]
  refusedBanner --> noRetry
```

## Code flow

Write readiness reads the cache phase separately. A successful refresh can restore readiness while the unconfirmed notice stays visible.

```mermaid
flowchart TD
  read["Planning cache refresh receives a read failure"] --> auth{"Scope lost?"}
  auth -->|401| reset["loseScope clears planning context and reports auth loss"]
  auth -->|other current read error| phase["Cache records failed phase or pending write readError"]
  write["Planning cache settles a failed write"] --> result{"Refusal or uncertain result?"}
  result -->|401| reset
  result -->|403 or another definite refusal| refused["markRefused records the reply; stale revision also refreshes"]
  result -->|lost or invalid reply, or committed identity reused| unknown["settleUnconfirmed creates a new history ID and refreshes without replay"]
  phase --> problem["readPlanningProblem checks current error and lastWrite"]
  refused --> problem
  unknown --> problem
  problem -->|403 error| deny["GatedMain renders the refusal Alert"]
  problem -->|other failed read| unavailable["GatedMain renders the unavailable Alert"]
  problem -->|unconfirmed and no read error| check["GatedMain asks the person to check the saved change"]
  problem -->|none| clear["No planning Alert"]
```

**Code references:** [planningCache.ts:304](../../apps/frontend/src/data/planning/planningCache.ts#L304) · [planningCache.ts:503](../../apps/frontend/src/data/planning/planningCache.ts#L503) · [planningCache.ts:525](../../apps/frontend/src/data/planning/planningCache.ts#L525) · [planningNotices.ts:29](../../apps/frontend/src/data/planning/planningNotices.ts#L29) · [planningReadiness.ts:5](../../apps/frontend/src/data/planning/planningReadiness.ts#L5) · [AppShell.tsx:163](../../apps/frontend/src/components/AppShell.tsx#L163)
