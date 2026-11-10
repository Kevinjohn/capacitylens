# US-NAV-06 — Choose appearance

As a company member, I want to choose this device’s light or dark appearance so that the interface suits my viewing conditions.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Sidebar theme action; Settings → My display

**Documentation:** [Settings](../../docs-src/using/settings.md)

**Source:** [AppSidebar.tsx](../../apps/frontend/src/components/AppSidebar.tsx); [theme.ts](../../apps/frontend/src/lib/theme.ts)

## Acceptance criteria

- Light, Dark, and Match system choices update the interface and persist as device preference; reduced-motion preference is respected.
