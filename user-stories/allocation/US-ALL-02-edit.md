# US-ALL-02 — Edit an existing allocation

**Area:** Allocation editor · **Persona:** Studio manager · **Linked E2E:** `e2e/allocation.spec.ts` → "edits an allocation and reflects the change on the bar"

## Goal
Change an existing allocation's hours, dates, status or note and see the bar update to match.

## Why
Plans change constantly — a booking stretches, drops to part-time, becomes tentative, or gains a note. The manager needs to adjust an existing booking in place rather than delete and recreate it, keeping its identity (and undo history) intact.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`); set zoom to **4w** and **Jump to date** → `2026-06-01`. The seed has a *Wireframes* bar on **Tyler Nix**.
1. Click the **Wireframes** bar. The **Edit allocation** dialog opens, pre-filled with the bar's current Assignee, Project, Task, dates, Hours / day, Status and Note.
2. Change **Hours / day** from its current value to `4`.
3. Change **End** to one day later.
4. Change **Status** to *Tentative*.
5. Type a **Note**, e.g. `Pending sign-off`.
6. Click **Save**. The dialog closes.

## Acceptance criteria
- ✅ Clicking a bar opens **Edit allocation** (not *New allocation*) with every field pre-filled from that allocation.
- ✅ After Save, the bar's label updates to show `· 4h`.
- ✅ The bar now extends one day further (its end date moved).
- ✅ Setting **Status** = *Tentative* renders the bar with a dashed border + hatched overlay and `data-status="tentative"`; setting it to *Completed* prefixes the label with a `✓` and sets `data-status="completed"`.
- ✅ Adding a **Note** adds a trailing `•` marker to the bar label (and the note shows in the hover popover).
