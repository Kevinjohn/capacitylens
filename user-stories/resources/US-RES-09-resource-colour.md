# US-RES-09 — A resource's colour comes from its discipline

As an Editor, I want resource colour to follow its discipline so that the schedule uses consistent group colours.

**Status:** Current
**Access:** Viewer, Editor, Admin or Owner
**Entry:** Disciplines screen → Edit discipline → Colour; Schedule → resource row
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [useResourceListModel.ts](../../apps/frontend/src/components/resources/useResourceListModel.ts) · [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)

## Acceptance criteria

- Add/Edit resource has no Colour control.
- With disciplines enabled, the Resources list swatch and the Schedule group use the assigned discipline’s colour; a person with no discipline uses neutral grey. With disciplines off, the list uses the resource’s stored colour.

## User flow

```mermaid
flowchart TD
  A["Disciplines screen"] --> B["Change discipline Colour"] --> C["Save"] --> D["Resource colour cues follow that discipline"]
  E["Resource without discipline"] --> F["Uses neutral fallback colour"]
```

## Code flow

```mermaid
flowchart TD
  A["DisciplineForm updates discipline colour"] --> B["Discipline update publishes current discipline data"]
  B --> C["useResourceListModel.resolveSwatchColor reads discipline colour"]
  B --> D["schedulerModel builds discipline group colour"]
  E["ResourceForm exposes no Colour field"] --> F["No per-resource colour edit path"]
```

**Code references:** [DisciplineForm.tsx](../../apps/frontend/src/components/disciplines/DisciplineForm.tsx) · [ResourceForm.tsx](../../apps/frontend/src/components/resources/ResourceForm.tsx) · [useResourceListModel.ts](../../apps/frontend/src/components/resources/useResourceListModel.ts) · [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)
