# US-NAV-09 — Mobile affordances (off-canvas sidebar, icon mode + rotate hint)

**Area:** Navigation · **Persona:** Studio manager on a phone · **Linked E2E:** `e2e/mobile.spec.ts` → "sidebar starts in icon mode and its destinations still navigate"

## Goal

Glance at the schedule from a phone without the sidebar eating the screen, and get a gentle
nudge that the week-grid works best in landscape.

## Why

Full mobile workflows are a non-goal (DECISIONS.md) — but testers do open CapacityLens on a phone.
Three light affordances keep that first contact sane: portrait uses a ShadCN off-canvas sheet,
compact landscape uses the desktop sidebar's collapsed icon mode, and portrait phones get a
one-per-session "turn it sideways" hint. Every destination remains a labelled,
keyboard-focusable link in both responsive forms.

## How (end-to-end)

**Precondition:** Seeded app; a phone or a desktop browser window narrowed/shortened to a
phone-ish size (≤ 767px wide, or ≤ 480px tall for landscape).

1. Open the app on a phone held **portrait**. A small dialog titled **Best in landscape**
   appears over the company picker.
2. Tap **Got it**. The dialog closes. Reload the page — it does not come back this session.
3. Still in portrait, pick **Studio North** and activate the **Expand menu** trigger in the top bar.
   An off-canvas dialog named **Sidebar** opens with labelled navigation links.
4. Choose **Projects**. The URL changes to `/projects` and the off-canvas sidebar closes.
5. Rotate the phone to **landscape**. The persistent sidebar is a narrow icons-only mode: no link labels, no company block, no Data
   section — just the toggle and nine icons (hover/long-press shows each section name).
6. Tap any icon-mode destination (say, the folder = Projects). The Projects list loads and the
   URL changes to `/projects`; the sidebar remains collapsed.
7. Click the **Expand menu** toggle. The expanded menu shows each link with its icon and label.
8. Click the **Collapse menu** toggle at the top of the sidebar. Icon mode returns.
9. Reload and pick the company again. The sidebar is still collapsed — the choice is
   remembered per device.
10. On a desktop-sized window the sidebar starts **open**, every link carries an icon, and
    the same toggle collapses/expands it.

## Acceptance criteria

- ✅ Every sidebar link shows an icon; the accessible name is still just the label
  (screen readers are unaffected).
- ✅ The sidebar toggle's accessible name flips **Collapse menu** ↔ **Expand menu** and
  carries `aria-expanded`.
- ✅ In portrait (≤ 767px), **Expand menu** opens a dialog named **Sidebar**; its destinations are
  labelled links, and choosing one navigates and closes the sheet.
- ✅ In compact landscape (> 767px wide but ≤ 480px tall), the persistent sidebar starts in icon
  mode when no choice is stored. On a normal desktop it starts open.
- ✅ Icon mode: link labels, the company block and Export/Import are hidden; nine destination
  icons show, each revealing its section label as an instant hover label to its right.
- ✅ Activating an icon-mode destination navigates directly and leaves the sidebar collapsed.
- ✅ Icon-mode destinations remain keyboard-focusable links with the same accessible label as
  their expanded form. Their decorative SVGs and the separate drag/click **SidebarRail** are
  `aria-hidden`; the navigation links are not.
- ✅ The open/collapsed choice persists per device (`capacitylens/sidebar`) across reloads.
- ✅ Portrait phone: the **Best in landscape** dialog appears (including over the company
  picker); **Got it**, Escape or a backdrop press dismisses it for the session
  (`sessionStorage`), and it re-appears in a fresh session.
- ✅ The hint never appears in landscape or on desktop; rotating to landscape hides an
  open hint.
- ✅ The open hint has no serious/critical WCAG 2.1 AA violations (axe test).
