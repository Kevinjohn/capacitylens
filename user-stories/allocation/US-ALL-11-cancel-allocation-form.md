# US-ALL-11 — Cancel allocation create or edit

As an Editor, I want to cancel an allocation form so that an unsaved draft is discarded.

**Status:** Current
**Access:** Editor, Admin or Owner
**Entry:** New allocation or Edit allocation dialog
**Documentation:** [schedule-work.md](../../docs-src/using/schedule-work.md)
**Source:** [AllocationDialog.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.tsx)

## Acceptance criteria

- **Cancel** or the close control closes the dialog without creating or changing an allocation.

## User flow

```mermaid
flowchart TD
  N1["Open create or edit allocation form"]
  N2["change draft"]
  N3["Cancel or close"]
  N4["dialog closes and schedule remains as before"]
  N1 --> N2
  N2 --> N3
  N3 --> N4
```

## Code flow

```mermaid
flowchart TD
  Dialog["SchedulerDialogHost mounts AllocationDialog with grid close callback"] --> Footer["AllocationFooter Cancel calls onClose"]
  Dialog --> Passive["FormDialog Escape or outside dismissal calls requestClose"]
  Passive -->|clean| Close["useFormLifetimeClose closes grid dialog and unmounts local draft"]
  Passive -->|dirty| Notice["Unsaved-changes notice; keep dialog open"]
  Footer --> Close
  Close -->|draft unsent| None["No allocation mutation"]
  Close -->|write already dispatched| Pending["Planning cache can still reconcile the write"]
```

The separately saved inline activity survives allocation form dismissal.

**Code references:**

- [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L196)
- [AllocationDialog.tsx](../../apps/frontend/src/components/scheduler/AllocationDialog.tsx#L24)
- [AllocationFooter.tsx](../../apps/frontend/src/components/scheduler/AllocationFooter.tsx#L59)
- [dialogs.tsx](../../apps/frontend/src/components/common/dialogs.tsx#L72)
- [dialogs.tsx](../../apps/frontend/src/components/common/dialogs.tsx#L154)
- [useFormLifetimeClose.ts](../../apps/frontend/src/hooks/useFormLifetimeClose.ts#L4)
- [allocationSubmit.ts](../../apps/frontend/src/components/scheduler/allocationSubmit.ts#L246)
