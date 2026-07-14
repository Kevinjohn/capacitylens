# US-SET-01 — Team calendar settings are set at creation, then frozen

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/onboarding.spec.ts` (capture at creation + disabled in Settings), `e2e/settings-calendar.spec.ts` (frozen/disabled), `e2e/onboarding.db.spec.ts` (server 409)

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
   **Timezone** (default *GMT*, with its UTC offset shown), and a read-only **Language** row
   (**English**). The company colour uses the default preset automatically.
3. Choose e.g. **Sunday** and **Europe/London**, type a name, click **Create company** → you land in
   the app for the new company.

**Frozen (in Settings):**
4. Open **Settings** → the **Calendar** section shows the chosen **Week starts on**, **Timezone** and
   **Language**, all **disabled**, with the explainer *"Set when the company was created and can't be changed."*
5. The **Company name** field and the **Disciplines** switch remain editable.

## Acceptance criteria
- The company-create form captures Week-starts-on, Timezone and Language with concrete defaults
  (Monday / GMT / English); creating passes them to the new account.
- In Settings, the **Calendar** section's Week-starts-on segmented control and Timezone select are
  **disabled**; a read-only **Language** row reads **English**; the freeze explainer is shown.
- Company **name** and **Disciplines** stay editable.
- A direct API `PATCH` of `language`, `weekStartsOn` or `timezone` on an existing account is rejected
  with **409**, and the stored value is unchanged.
- The Settings page passes an axe accessibility audit (no violations).
