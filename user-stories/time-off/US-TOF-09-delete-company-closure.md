# US-TOF-09 — Delete a company closure

As an Editor, I want to remove a company closure so that its dates no longer reduce available capacity.

**Status:** Current

**Access:** Editor, Admin or Owner

**Entry:** Time off page, Company closures section

**Documentation:** [time-off.md](../../docs-src/using/time-off.md)

**Source:** [CompanyClosureSection.tsx](../../apps/frontend/src/components/timeoff/CompanyClosureSection.tsx)

## Acceptance criteria

- **Delete** asks for confirmation; Cancel keeps the closure.
- Confirming Delete removes the closure band and restores availability on its dates.

## User flow

```mermaid
flowchart TD
  N1["Choose Delete on a company closure"]
  N2["confirmation appears"]
  B1["Cancel ; then  keep closure"]
  B2["Confirm ; then  closure band is removed and capacity recalculates"]
  N1 --> N2
  N1 -.-> B1
  N1 -.-> B2
```

## Code flow

```mermaid
flowchart TD
  A["CompanyClosureSection: Delete closure"] --> B["useConfirmDelete: confirmation dialog"]
  B -->|cancel| C["Keep closure"]
  B -->|confirm| D["deleteClosure(id)"]
  D --> E["typedPlanningActions.deleteClosure; planning reconciliation"]
  E --> F["List and schedule refresh"]
```

**Code references:**

- [CompanyClosureSection.tsx](../../apps/frontend/src/components/timeoff/CompanyClosureSection.tsx)
- [useConfirmDelete.ts](../../apps/frontend/src/hooks/useConfirmDelete.ts)
- [typedPlanningActions.ts](../../apps/frontend/src/store/typedPlanningActions.ts)
- [planningCacheController.ts](../../apps/frontend/src/data/planning/planningCacheController.ts)
