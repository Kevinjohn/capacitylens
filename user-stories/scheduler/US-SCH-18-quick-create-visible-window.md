# US-SCH-18 — Quick-create defaults to the date you're looking at

**Area:** Scheduler timeline · **Persona:** Studio manager · **Coverage:** manual — no dedicated automated test (the default is computed in `SchedulerGrid.tsx` → `visibleStartDate`)

## Goal
The row "+" defaults the new allocation's dates to the date currently at the **left edge of the viewport** — where the manager is actually looking — not always to today.

## Why
If quick-create always defaulted to today, then after scrolling out to plan, say, August, every "+" booking would land back in May and have to be re-dated. Defaulting to the visible window's left date means the new allocation appears where the manager's attention already is, so the common case (book this person *around here*) needs no date editing at all.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`). Set zoom to **4w**. (Note: **Jump to date** recenters the chosen date rather than pinning it to the left edge, so read the left-edge date from the timeline header — don't assume it equals the date you jumped to.)
1. **Jump to date** → `2026-06-01` so you're looking at a date range well away from today. Read the date now sitting at the **left edge** of the visible range from the timeline header.
2. On a resource row, click its **"+"** button.
3. In the **"New allocation"** modal, read the prefilled **Start** date.
4. Confirm **Start** matches the date at the **left of the viewport** you read in step 1 — not today's date.
5. Jump to a different month (e.g. `2026-08-01`) and click **"+"** again: the prefilled **Start** now matches *that* range's visible-left date, proving the default tracks the viewport rather than today.

## Acceptance criteria
- ✅ After scrolling/jumping, clicking a row's **"+"** prefills **Start** with the date at the **left edge of the visible window**, not today.
- ✅ Jumping to a different date and clicking **"+"** again prefills the new visible-left date (the default follows the viewport).
- ✅ When the timeline is scrolled away from today, the prefilled **Start** is the visible-left date, **not** the current real-world date.
