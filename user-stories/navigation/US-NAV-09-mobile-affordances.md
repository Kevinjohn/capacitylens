# US-NAV-09 — Use navigation on a narrow screen

As a company member viewing a narrow screen, I want compact navigation and a usable schedule view so that I can inspect information on that device.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Sidebar toggle; mobile Sidebar sheet

**Documentation:** [Read The Schedule](../../docs-src/using/read-the-schedule.md)

**Source:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx)

## Acceptance criteria

- At viewport widths up to 767 px, navigation opens as a labelled sheet from the top-bar sidebar toggle and closes after a destination is chosen; mobile scheduling workflows are out of scope.
