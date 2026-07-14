# US-SCH-15 — Allocation detail popover on hover/focus

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "shows a detail popover on hover (US-SCH-15)"

## Goal
Hovering — or keyboard-focusing — an allocation bar shows a detail popover with the activity, project · client, date range, hours/day, status and any note; it hides again when you leave.

## Why
A bar can only show so much on its face, especially when narrow. The manager often just wants the facts of one booking — what is it, for whom, when, how heavy, is it confirmed — without opening the edit modal and risking a change. A lightweight popover gives that on hover, and offering it on keyboard focus too means the same detail is reachable without a mouse.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w** and **Jump to date** → `2026-06-01` so the seed bars are in view.
1. Hover the **Brand System** bar.
2. A popover (`data-testid="allocation-popover"`) appears showing: the activity/label, **project · client** (e.g. *Brand Themes · Globex*), the **date range**, **Nh/day**, the **status**, and a note line if the allocation has one.
3. Move the pointer off the bar — the popover hides.
4. Now use the keyboard: **Tab** to focus an allocation bar. The same popover appears on focus.

## Acceptance criteria
- ✅ Hovering a bar shows the **allocation-popover** with the project/client and the date range.
- ✅ The popover includes hours/day, status, and (when present) the note.
- ✅ Moving the pointer off the bar hides the popover.
- ✅ Keyboard-focusing a bar (Tab) shows the same popover — it's not mouse-only.
