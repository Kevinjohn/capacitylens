# US-SET-01 — Team calendar settings are set at creation, then frozen

**Area:** Settings · **Persona:** Studio manager · **Linked automated coverage:** `e2e/onboarding.spec.ts` (capture at creation + read-only summary in Settings), `e2e/settings-calendar.spec.ts` (frozen summary/help + Settings axe), `e2e/onboarding.db.spec.ts` (server 409), `src/lib/timezones.test.ts` (numeric UTC offset labels and DST)

## Goal

Set the team's language, week-start day and time zone **when the company is created** so the
schedule reflects the company's working week and the correct "today" — and have those choices
**locked thereafter** so the team's calendar can't drift mid-stream.

## Why

A studio in a non-UTC time zone needs "today" to reflect their local day; a studio that works
Sunday–Thursday needs the schedule's week columns to start on Sunday. These are account-level facts
the whole team relies on, so they are captured once at onboarding and frozen — changing a company's
week-start or time zone after work is scheduled would silently re-interpret every existing date.
(P1.14. Language is English-only until Paraglide, but is captured + frozen the same way.)

## How (end-to-end)

**Capture (at creation):**

1. From the company picker, click **New company**.
2. The inline form shows **Company name**, **Week starts on** (Monday/Sunday, default Monday),
   and a searchable **Timezone** combobox preselected to the browser's IANA zone. Its options
   keep the local and common zones first and show a friendly name, current abbreviation and
   numeric UTC offset. A read-only **Language** row shows **English**. The company colour uses
   the default preset automatically.
3. Choose e.g. **Sunday** and **Europe/London**, type a name, click **Create company** → you land in
   the app for the new company.

**Frozen (in Settings):** 4. Open **Settings** → the final **Account Options Selected at Creation**
card shows four compact read-only rows: **Company name**, **Week starts on**, **Time zone** and
**Language**. 5. Open its question-mark help action to read why those choices cannot be changed here.

## Acceptance criteria

- The company-create form captures Week-starts-on, Timezone and Language (Monday / detected
  browser zone / English); creating passes them to the new account.
- Every Timezone option shows a friendly display name, its current abbreviation and a numeric
  offset such as **London — Europe/London (BST, UTC+01:00)**; the label handles daylight-saving
  changes rather than showing an unexplained IANA identifier alone.
- In Settings, **Account Options Selected at Creation** is the final card and shows Company name,
  Week starts on, Time zone (with numeric offset) and Language in a read-only table; no disabled
  form controls or ordinary company-name editing control are shown.
- Its question-mark action opens a labelled modal explaining that the values were selected at
  creation and cannot be changed here.
- A direct API `PATCH` of `language`, `weekStartsOn` or `timezone` on an existing account is rejected
  with **409**, and the stored value is unchanged.
- The Settings page passes an axe accessibility audit (no violations).
