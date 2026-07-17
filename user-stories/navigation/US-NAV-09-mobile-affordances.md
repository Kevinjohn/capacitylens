# US-NAV-09 — Mobile affordances (sidebar rail + rotate hint)

**Area:** Navigation · **Persona:** Studio manager on a phone · **Linked E2E:** `e2e/mobile.spec.ts` → "sidebar starts collapsed; rail icons reopen the menu instead of navigating"

## Goal
Glance at the schedule from a phone without the sidebar eating the screen, and get a gentle
nudge that the week-grid works best in landscape.

## Why
Full mobile workflows are a non-goal (DECISIONS.md) — but testers do open CapacityLens on a phone.
Three light affordances keep that first contact sane: nav items carry icons, the sidebar
collapses to an icons-only rail (collapsed by default on small screens), and portrait phones
get a one-per-session "turn it sideways" hint. The rail icons deliberately do **not**
navigate — a 48px rail is a poor tap target for nine destinations, so a tap just re-opens
the menu.

## How (end-to-end)

**Precondition:** Seeded app; a phone or a desktop browser window narrowed/shortened to a
phone-ish size (≤ 767px wide, or ≤ 480px tall for landscape).

1. Open the app on a phone held **portrait**. A small dialog titled **Best in landscape**
   appears over the company picker.
2. Tap **Got it**. The dialog closes. Reload the page — it does not come back this session.
3. Rotate the phone to **landscape**. Pick **Studio North**.
4. The sidebar is a narrow icons-only rail: no link labels, no company block, no Data
   section — just the toggle and nine icons (hover/long-press shows each section name).
5. Tap any rail icon (say, the folder = Projects). The menu **expands**; the URL does not
   change — you have not navigated.
6. The expanded menu shows each link with its icon and label. Click **Projects**; the
   Projects list loads.
7. Click the **Collapse menu** toggle at the top of the sidebar. The rail returns.
8. Reload and pick the company again. The sidebar is still collapsed — the choice is
   remembered per device.
9. On a desktop-sized window the sidebar starts **open**, every link carries an icon, and
   the same toggle collapses/expands it.

## Acceptance criteria

- ✅ Every sidebar link shows an icon; the accessible name is still just the label
  (screen readers are unaffected).
- ✅ The sidebar toggle's accessible name flips **Collapse menu** ↔ **Expand menu** and
  carries `aria-expanded`.
- ✅ With no stored choice, the sidebar starts collapsed on small screens (portrait *or*
  landscape phone) and open on desktop.
- ✅ Collapsed: link labels, the company block and Export/Import are hidden; nine rail
  icons show, each revealing its section label as an instant hover label to its right.
- ✅ Tapping a rail icon re-opens the menu and does **not** navigate.
- ✅ Rail icons are skipped by keyboard/assistive tech (`aria-hidden`, not tabbable); the
  toggle is the single accessible control for expanding.
- ✅ The open/collapsed choice persists per device (`capacitylens/sidebar`) across reloads.
- ✅ Portrait phone: the **Best in landscape** dialog appears (including over the company
  picker); **Got it**, Escape or a backdrop press dismisses it for the session
  (`sessionStorage`), and it re-appears in a fresh session.
- ✅ The hint never appears in landscape or on desktop; rotating to landscape hides an
  open hint.
- ✅ The open hint has no serious/critical WCAG 2.1 AA violations (axe test).
