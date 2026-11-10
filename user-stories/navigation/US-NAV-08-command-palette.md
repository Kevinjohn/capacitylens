# US-NAV-08 — Jump with the command palette

As a company member, I want to search available pages and schedule destinations from the keyboard so that I can navigate quickly.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer; results respect destination access

**Entry:** ⌘K / Ctrl+K; palette search and result controls

**Documentation:** [Read The Schedule](../../docs-src/using/read-the-schedule.md)

**Source:** [CommandPalette.tsx](../../apps/frontend/src/components/CommandPalette.tsx)

## Acceptance criteria

- The palette opens focused, filters destinations and entities, and navigates only to available results.

## User flow

```mermaid
flowchart TD
  shortcut["Press Cmd/Ctrl+K"] --> open["Search palette opens focused"]
  open --> search["Search available pages or schedule items"]
  search --> choose["Choose a result"]
  choose --> destination["Destination opens"]
  open -->|Escape| close["Palette closes"]
```

## Code flow

```mermaid
flowchart TD
  key["useGlobalShortcuts handles Cmd/Ctrl+K"] --> state["AppShell paletteOpen state"]
  state --> palette["CommandPalette filters available items"]
  palette --> navigate["useNavigate opens selected destination"]
  palette --> close["Escape closes palette"]
```

**Code references:** [useAppShellController.ts](../../apps/frontend/src/components/useAppShellController.ts); [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx); [CommandPalette.tsx](../../apps/frontend/src/components/CommandPalette.tsx)
