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
  model["SchedulerGrid supplies grid semantics and two columns from the row model"] --> rows["SchedulerGridRows passes group and row data to SchedulerGridRow"]
  rows --> header["SchedulerGridRowHeader renders rowheader in column one"]
  header --> summary["buildRowScreenReaderSummary reads row capacity, conflicts, half days and time-off count"]
  summary --> conditional["Include personal utilisation when enabled and tracked; omit allocation count in Time off mode"]
  conditional --> text["Render nonempty summary parts in sr-only text"]
  rows --> cell["ResourceLane provides gridcell in column two"]
```

**Code references:** [SchedulerGrid.tsx:349](../../apps/frontend/src/components/scheduler/SchedulerGrid.tsx#L349) · [SchedulerGridRows.tsx:87](../../apps/frontend/src/components/scheduler/SchedulerGridRows.tsx#L87) · [SchedulerGridRow.tsx:187](../../apps/frontend/src/components/scheduler/SchedulerGridRow.tsx#L187) · [buildRowScreenReaderSummary.ts:17](../../apps/frontend/src/components/scheduler/buildRowScreenReaderSummary.ts#L17) · [ResourceLane.tsx:220](../../apps/frontend/src/components/scheduler/ResourceLane.tsx#L220)
