# US-RES-09 — A resource's colour comes from its discipline

As an Editor, I want resource colour to follow its discipline so that the schedule uses consistent group colours.

**Status:** Current
**Access:** Editor and above (Editor, Admin, Owner)
**Entry:** Disciplines screen → Edit discipline → Colour; Schedule → resource row
**Documentation:** [Guide](../../docs-src/using/resources.md)
**Source:** [useResourceListModel.ts](../../apps/frontend/src/components/resources/useResourceListModel.ts) · [schedulerModel.ts](../../apps/frontend/src/components/scheduler/schedulerModel.ts)

## Acceptance criteria

- Add/Edit resource has no Colour control.
- The resource avatar and schedule cues use the assigned discipline colour, or the neutral fallback when no discipline is assigned.
