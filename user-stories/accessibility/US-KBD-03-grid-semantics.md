# US-KBD-03 — Understand the schedule grid with assistive technology

As a screen-reader user, I want schedule rows and capacity summaries exposed semantically so that I can understand the schedule without colour cues.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Schedule grid accessibility tree

**Documentation:** [Read The Schedule](../../docs-src/using/read-the-schedule.md)

**Source:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx)

## Acceptance criteria

- The grid exposes row and cell relationships and each resource row announces applicable capacity and time-off information.

## User flow

```mermaid
flowchart TD
  human1["Navigate the schedule grid with a screen reader"]
  human2["Hear row and timeline structure"]
  human3["Hear resource capacity and time-off summary"]
  human4["Understand status without color alone"]
  human1 --> human2
  human2 --> human3
  human3 --> human4
```

## Code flow

```mermaid
flowchart TD
  grid["SchedulerGrid declares grid and column count"] --> rows["SchedulerGridRows renders resource rows"]
  rows --> row["SchedulerGridRow renders rowheader and gridcell"]
  row --> summary["buildRowScreenReaderSummary creates sr-only summary"]
  summary --> capacity["schedulerRowCapacity supplies capacity conditions"]
```

**Code references:** [SchedulerGrid.tsx](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx); [SchedulerGridRows.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRows.tsx); [SchedulerGridRow.tsx](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx); [buildRowScreenReaderSummary.ts](../../apps/frontend/src/components/scheduler/buildRowScreenReaderSummary.ts); [schedulerRowCapacity.ts](../../apps/frontend/src/components/scheduler/schedulerRowCapacity.ts)
