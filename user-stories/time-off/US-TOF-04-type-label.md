# US-TOF-04 — Time-off list reads terse; the type label lives on the timeline

As a company member, I want the time-off list to show who is away and for how long so that I can scan upcoming availability changes.

**Status:** Current

**Access:** Viewer, Editor, Admin or Owner

**Entry:** Time off page

**Documentation:** [time-off.md](../../docs-src/using/time-off.md)

**Source:** [TimeOffForm.tsx](../../apps/frontend/src/components/time-off/TimeOffForm.tsx)

## Acceptance criteria

- The Time off list groups entries under each resource and shows each entry’s start date and length in days; it does not show the type.
- The Schedule block shows the type (Holiday, Sick, Unpaid or Other) when the block is wider than 44 pixels, and always exposes it to assistive technology.

## User flow

```mermaid
flowchart TD
  N1["Open Time off page"]
  N2["scan resource, start date and duration in the list"]
  N3["read the type on its schedule block"]
  N1 --> N2
  N2 --> N3
```

## Code flow

```mermaid
flowchart TD
  Read["Authorized planning data contains projected personal time off"] --> List["TimeOffList → buildTimeOffGroups"]
  List --> Row["TimeOffItem displays start and inclusive duration"]
  Read --> Model["schedulerRowModel builds visible time-off block"]
  Model -->|block absent from materialized range| Hidden["No block"]
  Model --> Render["ResourceLane → ScheduleSignals supplies type to accessible label"]
  Render -->|width over 44 px| Label["Show visible type"]
  Render -->|width at most 44 px| Compact["Keep accessible label"]
```

The list uses start and duration. The Schedule renders the personal time-off type separately from the company closure band.

**Code references:**

- [TimeOffList.tsx](../../apps/frontend/src/components/time-off/TimeOffList.tsx#L98)
- [timeOffView.ts](../../apps/frontend/src/components/time-off/timeOffView.ts#L41)
- [schedulerRowModel.ts](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L44)
- [ResourceLane.tsx](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L103)
- [TimeOffList.test.tsx](../../apps/frontend/src/components/time-off/TimeOffList.test.tsx#L140)
