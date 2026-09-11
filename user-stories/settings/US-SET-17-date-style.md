# US-SET-17 — Choose the date format

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/settings-date-style.spec.ts`

## Goal

Let each person pick how dates read in the app — `9 Sep`, `9th Sep`, `Sep 9` or `Sep 9th` — so the
schedule matches the convention they already think in.

## Why

A studio with people either side of the Atlantic reads `9 Sep` and `Sep 9` at different speeds, and
some people simply want the ordinal. It's a per-browser viewing choice (like the theme), not shared
account data, so nobody has to agree. It defaults to **9 Sep**, the format the app has always used.

## How (end-to-end)

**Precondition:** Seeded app open on the Schedule (clock inside the seed window — see _Seed data_ in
REFERENCE.md).

1. Open **Settings** (sidebar). In the **Appearance** section, below the theme control, find the
   **Date format** control. The checked option is **9 Sep**, and every option is labelled with a
   sample of the format it produces.
2. Pick **Sep 9**.
3. Open **Time off** from the sidebar. Bruce Wayne's first row now reads `Mon Jun 8th` where it read
   `Mon 8th Jun` before.
4. Return to **Schedule**. A range inside one month reads `Sep 9 – 14`; one that crosses a month
   reads `Sep 9 – Oct 14`.
5. Reload the page: **Sep 9** is still the checked option and the dates still read month-first.

## Acceptance criteria

- Settings → **Appearance** shows a **Date format** control (accessible name `Date format`) below the
  theme control, with four options: **9 Sep**, **9th Sep**, **Sep 9**, **Sep 9th**.
- Each option is labelled with a sample of the format, and **9 Sep** is checked by default.
- The choice sets day/month order and whether the day number carries an ordinal, on single dates and
  on ranges, wherever the app shows a human-readable date.
- A date range inside one month shows the month once (`9 – 14 Sep`, `Sep 9 – 14`); a range across two
  months shows both (`9 Sep – 14 Oct`, `Sep 9 – Oct 14`).
- Weekday forms (`Mon 8th Jun` / `Mon Jun 8th`) always keep the ordinal, whatever the preference.
- The choice survives a reload in the same browser (device-global `capacitylens/dateStyle`), is
  **not** on the account, and is **not** included in Export JSON.
- Machine dates — ISO inputs, exports and URLs — are unchanged.
