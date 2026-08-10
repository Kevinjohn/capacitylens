# US-TBR-08 — Navigation re-anchors the left edge to the week start

**Area:** Toolbar · **Persona:** Studio manager · **Linked E2E:** `e2e/scheduler.spec.ts` → "navigation re-anchors the left edge to the week start (with the free-scroll snap OFF)" — the one test that asserts the Monday re-anchor for **Weeks visible**, **Next**, **Prev** and **Today**

## Goal

Whenever the manager navigates the timeline — a **Weeks visible** choice (1/2/4/6/8 weeks), **Prev**/**Next**, or **Today** — the grid's leftmost column always lands on the week start (the account `weekStartsOn`, default Monday), never mid-week.

## Why

This is a weekly view. A left edge parked on a Wednesday makes every week boundary read off-by-a-few-days and makes the helicopter scan harder. Snapping the left edge to the week start on every deliberate navigation keeps the grid reading as whole weeks. This **navigation snap** is always on. The separate **Snap to week start** setting governs only an idle free scroll; it defaults on, but a manager may turn it off. A pure window resize or the Minimise-weekends toggle preserves the exact left-edge date.

## How (end-to-end)

**Precondition:** Seeded app open at **Schedule** (`/`), viewport ~1440 wide. In **Settings → Schedule**, turn **Snap to week start** off so its idle free-scroll behavior cannot mask the always-on navigation behavior, then return to **Schedule**. (Do not pre-set **Weeks visible** — this story changes it.)

1. Open **Weeks visible** and choose **1 week**. Read the leftmost date-header column — its weekday label is **Mon** (the focused week start).
2. Scroll the grid right by ~2.5 day columns so the leftmost column is now a mid-week day (e.g. its label reads **Wed**).
3. Open **Weeks visible** and choose **2 weeks**.
4. Scroll right by ~2.5 day columns again so the left edge is mid-week again.
5. Click **Next**.
6. Scroll right by ~2.5 day columns again so the left edge is mid-week again, then click **Prev**.

## Acceptance criteria

- ✅ After step 1, the leftmost column's weekday label is **Mon**.
- ✅ After step 2, the leftmost column's weekday label is **not** Mon (sanity: with the free-scroll setting off, navigation has a genuinely mid-week starting point).
- ✅ After the **Weeks visible** change (step 3), the leftmost column's weekday label is back to **Mon**.
- ✅ After the **Next** pan (step 5), the leftmost column's weekday label is **Mon**.
- ✅ After the **Prev** pan (step 6), the leftmost column's weekday label is **Mon** — the left edge always lands on the week start regardless of navigation direction.
- ✅ A pure browser-window resize or toggling **Minimise weekends** does **not** re-anchor — it keeps the exact left-edge date.
