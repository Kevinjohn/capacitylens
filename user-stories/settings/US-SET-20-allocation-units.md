# US-SET-20 — Choose scheduling units

As a company Editor, I want to choose scheduling units so that bookings use the company’s preferred measure.

**Status:** Current
**Access:** Owner, Admin, Editor
**Entry:** Settings → Company setup → Allocation units
**Documentation:** [Settings](../../docs-src/using/settings.md)
**Source:** [SettingsSchedulingSection.tsx](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx)

## Acceptance criteria

| Field            | Control           | Required/default/conditions                                 |
| ---------------- | ----------------- | ----------------------------------------------------------- |
| Scheduling input | Segmented control | Hours, Days or Blocks; company-wide, read-only for Viewers. |

## User flow

```mermaid
flowchart TD
A["Open Settings: Scheduling input: Hours, Days or Blocks"] --> B["Choose the company setting"]
B --> C{"Change accepted?"}
C -->|yes| D["Use the selected allocation inputs"]
C -->|no or uncertain| E["Read the visible error and resolve it before continuing"]
```

## Code flow

The [company setting write path](../REFERENCE.md#company-setting-writes) traces the common no-op, server commit, refusal and reconciliation branches.

```mermaid
flowchart TD
  read["resolveSchedulingMode reads the stored mode, with Hours fallback"] --> control["SchedulingModeSection renders current setting and disables when canEdit is false"]
  control -->|new editable selection| write["updateSetting sends schedulingMode through shared company write path"]
  write -->|accepted state| dialog["useAllocationDialogState and AllocationScheduleFields read the new mode"]
  dialog -->|external party| span["Literal Start and End with no load control"]
  dialog -->|tracked assignee, Hours| hours["Start, End and Hours per day"]
  dialog -->|tracked assignee, Days| days["Start, Days of work and Days over"]
  dialog -->|tracked assignee, Blocks| blocks["Start and Days over"]
```

**Code references:** [selectors.ts:36](../../apps/frontend/src/store/selectors.ts#L36) · [SettingsSchedulingSection.tsx:65](../../apps/frontend/src/components/settings/SettingsSchedulingSection.tsx#L65) · [initial_company_defaults.ts:30](../../apps/backend/app/services/initial_company_defaults.ts#L30) · [useAllocationDialogState.ts:42](../../apps/frontend/src/components/scheduler/useAllocationDialogState.ts#L42) · [AllocationScheduleFields.tsx:123](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx#L123) · [AllocationScheduleFields.tsx:281](../../apps/frontend/src/components/scheduler/AllocationScheduleFields.tsx#L281)
