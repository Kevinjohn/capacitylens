# US-SET-01 — Configure team calendar settings

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/settings-calendar.spec.ts` → "week-start setting changes the week grouping on the schedule"

## Goal
Set the team's week-start day and time zone so the schedule reflects the company's working week and correct "today".

## Why
A studio in a non-UTC time zone needs "today" to reflect their local day. A studio that
works Sunday–Thursday needs the schedule's week columns to start on Sunday, not Monday.
Both settings are account-level so the whole team sees a consistent view.

## How (end-to-end)
**Precondition:** Seeded app open; click **Settings** in the sidebar.

1. In the **Calendar** section, find the **Week starts on** segmented control.
2. Click **Sunday**. The control shows Sunday selected.
3. Navigate to **Schedule** (sidebar). The week grouping now starts on Sunday — the block containing today opens on a Sunday.
4. Return to **Settings**. Find the **Timezone** select.
5. Choose a different time zone (e.g. *Europe/London*). The select updates.

## Acceptance criteria
- The Calendar section appears between Scheduling and Utilisation in Settings.
- By default **Monday** is selected and the timezone shows **GMT**.
- Selecting **Sunday** immediately updates `aria-checked="true"` on that button.
- After selecting Sunday, the Schedule's week grouping shifts so week blocks open on Sunday.
- Selecting a timezone from the dropdown persists it (choosing *Europe/London* and returning to Settings still shows *Europe/London*).
- The Timezone select contains at least the current value (so a stored non-default zone is always selectable).
- The Settings page passes an axe accessibility audit (no violations).
