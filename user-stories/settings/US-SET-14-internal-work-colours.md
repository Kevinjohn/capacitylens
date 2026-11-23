# US-SET-14 — Use neutral internal-work colours

As a company member, I want internal work to use neutral grey so that it stays distinct from client work.

**Status:** Current
**Access:** Owner, Admin, Editor, Viewer
**Entry:** Schedule and activity views
**Documentation:** [Schedule and change work](../../docs-src/using/schedule-work.md)
**Source:** [AllocationBar.tsx](../../apps/frontend/src/components/scheduler/AllocationBar.tsx), [ProjectForm.tsx](../../apps/frontend/src/components/projects/ProjectForm.tsx)

## Acceptance criteria

- Internal work uses neutral grey; no internal-work colour control is available.

## User flow

```mermaid
flowchart TD
A["View internal work on the Schedule"] --> B["Read its neutral grey presentation"]
B --> C["Distinguish internal work from client work"]
```

## Code flow

External-party work shares the neutral colour, so neutral bars alone cannot distinguish Internal work.

```mermaid
flowchart TD
  project["ProjectForm checks whether selected client is Internal"] -->|yes| hide["Omit the project Colour picker"]
  list["ProjectList renders a project swatch"] --> projectColour["resolveProjectColor returns neutral for built-in Internal client"]
  model["schedulerRowModel computes allocation colour via resolveBarColor"] --> rule{"Which work owns the bar colour?"}
  rule -->|external party| neutral["Use neutral grey"]
  rule -->|Internal activity or effective Internal project| neutral
  rule -->|other work| chosen["Use project colour, then client, then resource, then neutral"]
  neutral --> bar["AllocationBar renders the resolved colour"]
  chosen --> bar
```

**Code references:** [ProjectForm.tsx:59](../../apps/frontend/src/components/projects/ProjectForm.tsx#L59) · [ProjectList.tsx:35](../../apps/frontend/src/components/projects/ProjectList.tsx#L35) · [color.ts:89](../../packages/shared/src/lib/color.ts#L89) · [color.ts:110](../../packages/shared/src/lib/color.ts#L110) · [schedulerRowModel.ts:99](../../apps/frontend/src/components/scheduler/schedulerRowModel.ts#L99)
