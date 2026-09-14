# US-SET-17 — Choose the date format

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:**
`e2e/settings-date-style.spec.ts`, `e2e/settings-date-style.db.spec.ts` ·
**Docs:** [Settings → Date format](../../docs-src/guide/settings.md)

## Goal

Let a company pick how planning dates read — `9 Sep`, `9th Sep`, `Sep 9` or `Sep 9th` — so
everyone reads the schedule in one convention.

## Why

A studio with people either side of the Atlantic reads `9 Sep` and `Sep 9` at different speeds, and
some people simply want the ordinal. The point is agreement: a schedule where half the rows read
`9 Sep` and half read `Sep 9` is harder to scan than either format alone, and a date spoken in a
stand-up has to mean the same thing to everyone hearing it. So it is an account setting, changed by
an editor or above and applied to every member, not a per-browser preference like the theme. It
defaults to **9 Sep**, the format the app has always used.

## How (end-to-end)

**Precondition:** Seeded app open on the Schedule, signed in as an editor or above (clock inside the
seed window — see _Seed data_ in REFERENCE.md).

1. Open **Settings** (sidebar). Find the **Date format** section. The
   checked option is **9 Sep**, and every option is labelled with a sample of the format it produces.
2. Pick **Sep 9**. Dates already on screen change immediately — this is company data, not a
   device preference, so nothing waits for a reload.
3. Open **Time off** from the sidebar. Bruce Wayne's first row now reads `Wed Jun 10th` where it
   read `Wed 10th Jun` before.
4. Return to **Schedule**. A range inside one month reads `Sep 9 – 14`; one that crosses a month
   reads `Sep 9 – Oct 14`; one that crosses a year reads `Dec 28, 2026 – Jan 8, 2027`.
5. Reload, or sign in from another browser: **Sep 9** is still the checked option, because the
   choice belongs to the company.

## Acceptance criteria

- Settings → **Date format** shows a control (accessible name `Date format`) with four
  options: **9 Sep**, **9th Sep**, **Sep 9**, **Sep 9th**.
- Each option is labelled with a sample of the format, and **9 Sep** is checked by default.
- An **editor or above** may change it. A viewer sees the control, disabled — the same treatment
  every other account setting gives a role that cannot change it.
- The choice sets day/month order and whether the day number carries an ordinal on planning dates,
  including single calendar dates and ranges, and takes effect **without a reload**.
- A date range inside one month shows the month once (`9 – 14 Sep`, `Sep 9 – 14`); a range across two
  months shows both (`9 Sep – 14 Oct`, `Sep 9 – Oct 14`).
- A standalone date range that crosses a year collapses nothing: both ends carry the year
  (`28 Dec 2026 – 8 Jan 2027`), including in the short list form that otherwise never shows one —
  without it a range from one December to the next January reads as a single day. The ordered
  week-column headers in Overview are the deliberate narrow exception: neighbouring columns supply
  the calendar context, so their one cross-year week may read `28 Dec – 3 Jan`. Screen-reader names
  that state the two dates separately, such as an allocation bar's, carry the year on the general rule.
- Weekday forms (`Mon 8th Jun` / `Mon Jun 8th`) always keep the ordinal, whatever the preference.
- The choice is **account data**: it is stored on the account, it appears in Export JSON, changing it
  is undoable, and every member of the company sees it. It is **not** a device preference and is not
  kept in browser storage.
- Server instants use the viewer's browser locale and local time zone instead. This includes session
  creation and expiry, password-reset expiry, invitation expiry in the Team & access member panel
  and on the invitee's Accept invite page, ownership-transfer deadlines and ownership outcome dates.
  The offline read-only banner's last-updated timestamp also uses the viewer's browser locale and
  local time zone. The exception still applies when an instant is shown as a date without a time:
  the browser's time zone decides which local calendar day it falls on, and its locale decides the
  date order.
- Existing date-and-time displays keep their time, while existing compact date-only displays stay
  date-only. Local conversion never slices the date from a raw UTC timestamp.
- Machine dates — ISO inputs, exports and URLs — are unchanged.
