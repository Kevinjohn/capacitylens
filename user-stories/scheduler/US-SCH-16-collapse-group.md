# US-SCH-16 — Collapse and expand a discipline group

**Area:** Scheduler timeline · **Persona:** Studio manager · **Linked E2E:** `e2e/features.spec.ts` → "clicking a discipline header collapses its rows"

## Goal
Collapse a discipline group from its header (the chevron); the group's resource rows hide and the header shows an "N hidden" count, while the header itself stays. Clicking again expands it.

## Why
A busy studio has more rows than fit on one screen. When the manager is focused on, say, Development, being able to fold away Design and Copywriting keeps the relevant rows in view without scrolling past noise. Keeping the header (with a count of what's hidden) means nothing is lost — the group is one click from coming back.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). **Tyler Nix** sits under the **Design** group.
1. Click the **Design** discipline group header (its chevron toggles it).
2. The resource rows under Design hide — **Tyler Nix**'s row disappears from the grid.
3. The **Design** group header itself remains (`data-testid="discipline-group"`), now showing an **"N hidden"** count of its folded rows (see US-SCH-14).
4. Click the **Design** header again. The group expands and **Tyler Nix**'s row returns.

## Acceptance criteria
- ✅ Clicking the group header hides that group's resource rows (e.g. **Tyler Nix** is no longer in the grid).
- ✅ The **discipline-group** header itself remains visible after collapsing.
- ✅ The collapsed header shows an **"N hidden"** count.
- ✅ Clicking the header again expands the group and restores its rows.
