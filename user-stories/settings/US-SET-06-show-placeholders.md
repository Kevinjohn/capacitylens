# US-SET-06 — Show placeholders on the schedule

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/placeholders.spec.ts` → "hidden by default: the seeded placeholder is absent from the schedule and Resources list", "turning it on in Settings reveals the placeholder with a \"?\" avatar and \"Placeholder\" name", "the choice survives a reload (device-global pref)"

## Goal
Keep "slot" placeholders out of the way by default, and let anyone who plans with them switch them on per-browser — showing each unfilled slot as a named **"Placeholder"** row with a question-mark avatar.

## Why
A placeholder is an unfilled slot you pencil in before a real person is assigned. Most studios
glancing at the helicopter view only want the actual people; the empty slots are clutter. So the
feature is **off by default** and lives behind a per-browser display pref (like the theme), not
shared account data. Turning it off only HIDES placeholders — their data is untouched and returns
when the switch goes back on, so it never breaks a dataset that already has placeholders.

## How (end-to-end)
**Precondition:** Seeded app open (clock inside the seed window — see *Seed data* in REFERENCE.md). The seed contains one placeholder (*Senior Designer*, bound to Project Lightning), hidden by default.

1. On the Schedule, note there is **no placeholder row** — only the real people (Tyler, Pam, Nike, Alex) and the External band. The placeholder's bar (Visual Design) is not drawn.
2. Open **Resources** (sidebar). There is **no "Placeholders" section** and **no "Add placeholder" button** — only the people list.
3. Open **Settings** (sidebar). In the **Placeholders** section, find the **Show placeholders** switch — it's **off**.
4. Switch it **on**.
5. Return to **Resources**: the **Placeholders** section and its **Add placeholder** button now appear, with the seeded placeholder shown as **"Placeholder"** (its role *Senior Designer* in the secondary text).
6. Return to **Schedule**: a row now appears in the Design band showing the name **"Placeholder"** with a **"?"** avatar and its Visual Design bar.
7. Switch it back **off** in Settings — the placeholder disappears again everywhere; its data is intact.
8. (Optional) Reload the page and re-pick **Studio North**: the choice is remembered.

## Acceptance criteria
- The **Placeholders** section appears in Settings with a single **Show placeholders** switch (`role="switch"`, accessible name `Show placeholders`).
- The switch defaults to **off** (`aria-checked="false"`) — placeholders are hidden out of the box.
- With it **off**: no placeholder row appears on the schedule (and a placeholder contributes nothing to per-discipline / overall utilisation), no placeholder option appears in the assignee picker or the ⌘K command palette, and the Resources page hides its **Placeholders** section and **Add placeholder** button. A dataset that already contains placeholders **hides** them — it never errors.
- With it **on**: a placeholder shows the literal name **"Placeholder"** with a **"?"** avatar (its role/discipline as secondary text); the assignee picker labels it **"Placeholder (slot)"**.
- Editing an allocation that already targets a placeholder keeps that placeholder selectable in the assignee picker even while the pref is off, so editing never silently reassigns the work.
- The choice survives a reload in the same browser (device-global `floaty/placeholdersEnabled`), is **not** on the account, and is **not** included in Export JSON.
