# US-TBR-08 — Navigation re-anchors the left edge to the week start

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "navigation re-anchors the left edge to the week start" · `e2e/toolbar.spec.ts` → "jumps to a chosen date"

## Goal
Whenever the manager navigates the timeline — zoom (1/2/4/6/8w), **Prev**/**Next**, or the **Jump to date** picker — the grid's leftmost column always lands on the week start (the account `weekStartsOn`, default Monday), never mid-week.

## Why
This is a weekly view. A left edge parked on a Wednesday makes every week boundary read off-by-a-few-days and makes the helicopter scan harder. Snapping the left edge to the week start on every deliberate navigation keeps the grid reading as whole weeks. It is **always on** — there is no setting. A pure window resize or the Minimise-weekends toggle is the exception: it preserves the exact left-edge date so a deliberately free-positioned view is not yanked off the day you parked it on.

## How (end-to-end)
**Precondition:** Seeded app open at **Schedule** (`/`), viewport ~1440 wide. (Do not pre-set zoom — this story changes it.)
1. Click **1w**. Read the leftmost date-header column — its weekday label is **Mon** (the focused week start).
2. Scroll the grid right by ~2.5 day columns so the leftmost column is now a mid-week day (e.g. its label reads **Wed**).
3. Click **2w**.
4. Scroll right by ~2.5 day columns again so the left edge is mid-week again.
5. Click **Next**.
6. Set the **Jump to date** input to `2026-09-10` (a Thursday).

## Acceptance criteria
- ✅ After step 1, the leftmost column's weekday label is **Mon**.
- ✅ After step 2, the leftmost column's weekday label is **not** Mon (sanity: free-scroll is not snapped on its own).
- ✅ After the zoom click (step 3), the leftmost column's weekday label is back to **Mon**.
- ✅ After the **Next** pan (step 5), the leftmost column's weekday label is **Mon**.
- ✅ After the date jump (step 6), the **Jump to date** input snaps to and holds that week's Monday, **`2026-09-07`** (not the Thursday typed), and the header reads **"Sep 2026"**.
- ✅ A pure browser-window resize or toggling **Minimise weekends** does **not** re-anchor — it keeps the exact left-edge date.
