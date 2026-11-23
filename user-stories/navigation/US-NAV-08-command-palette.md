# US-NAV-08 — Jump with the command palette

As a company member, I want to search available pages and schedule destinations from the keyboard so that I can navigate quickly.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer; results respect destination access

**Entry:** ⌘K / Ctrl+K; palette search and result controls

**Documentation:** [Read The Schedule](../../docs-src/using/read-the-schedule.md)

**Source:** [CommandPalette.tsx](../../apps/frontend/src/components/CommandPalette.tsx); [buildPaletteItems.ts](../../apps/frontend/src/components/buildPaletteItems.ts)

## Acceptance criteria

- ⌘K / Ctrl+K opens or closes the palette with its search box focused. It does not open during IME composition or over another open dialog; with unsaved form changes it shows "You have unsaved changes — use Cancel or Save to close this dialog." instead.
- With no query, the palette lists **Go to today** and every page the role can open; Overview, Diagnostics and Disciplines appear only when available; Diagnostics is listed here and on Help, not in the sidebar. Typing fuzzy-matches pages and active people, projects, clients and activities, up to five per section; a date typed as YYYY-MM-DD adds **Go to date {date}**. People exclude placeholders and external resources while those settings are off.
- Selecting a page opens it. A person opens the Schedule with filters cleared and scrolls to that row; a project or client opens the Schedule filtered to it; an activity opens Activities with it selected.

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

The dialog shortcut check only recognizes open elements marked aria-modal. The shared alert-dialog wrapper does not supply that marker.

```mermaid
flowchart TD
  key["useGlobalShortcuts receives Cmd or Ctrl+K"] --> guard{"handlePaletteShortcut allows toggle?"}
  guard -->|composition or marked modal| exit["Leave palette state unchanged"]
  guard -->|dirty form| notice["Prevent default and publish Unsaved changes once per non-repeated keydown"]
  guard -->|repeat with clean form| repeated["Prevent default without toggling"]
  guard -->|allowed| open["Toggle paletteOpen; GatedApp mounts CommandPalette while clean"]
  open --> build["usePaletteItems calls buildPaletteItems with visible routes and active scoped data"]
  build -->|empty query| base["Offer Today and visible pages"]
  build -->|query| search["Filter actions, pages and entities; add date action for valid ISO date"]
  base --> pick["PaletteResults invokes the selected onSelect"]
  search --> pick
  pick -->|page or activity| nav["navigate to route or encoded activity hash"]
  pick -->|Today, date, resource, project or client| schedule["Navigate to Schedule then run the corresponding date, jump or filter action"]
  nav --> close["onClose clears paletteOpen"]
  schedule --> close
  open -->|Escape or backdrop| close
```

**Code references:** [globalShortcuts.ts:19](../../apps/frontend/src/components/app-shell/globalShortcuts.ts#L19) · [shortcutFilters.ts:18](../../apps/frontend/src/lib/shortcutFilters.ts#L18) · [AppShell.tsx:124](../../apps/frontend/src/components/AppShell.tsx#L124) · [CommandPalette.tsx:49](../../apps/frontend/src/components/CommandPalette.tsx#L49) · [CommandPalette.tsx:165](../../apps/frontend/src/components/CommandPalette.tsx#L165) · [buildPaletteItems.ts:54](../../apps/frontend/src/components/buildPaletteItems.ts#L54) · [buildPaletteItems.ts:101](../../apps/frontend/src/components/buildPaletteItems.ts#L101) · [buildPaletteItems.ts:164](../../apps/frontend/src/components/buildPaletteItems.ts#L164)
