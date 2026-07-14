# US-SET-07 — Show external / 3rd parties

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/external.spec.ts` → "hidden by default: the seeded external is absent from the schedule and the Resources tab", "turning it on in Settings reveals the External section (with explainer) in the Resources tab and the band on the schedule", "the choice survives a reload (per-account pref)"

## Goal
Keep external / 3rd-party companies out of the way by default, and let anyone who hands work to outside partners switch them on per-browser — showing each external in a neutral band at the bottom of the schedule, and an **External** section under the Resources tab.

## Why
An external / 3rd party is an outside company you hand work to but don't manage (a print shop, an
overflow studio). It appears on the schedule so you can see the handoff, but carries no hours and
never counts toward your team's capacity or utilisation. Many studios glancing at the helicopter
view only want their own people, so the feature is **off by default** and lives behind a **per-account**
setting on the Account (`externalEnabled`, absent = off, like Placeholders and `disciplinesEnabled`). Turning it off only HIDES
externals — their data is untouched and returns when the switch goes back on, so it never breaks a
dataset that already has externals. (External moved here from its old standalone `/external` tab; the
old URL now redirects to `/resources`.)

## How (end-to-end)
**Precondition:** Seeded app open (clock inside the seed window — see *Seed data* in REFERENCE.md). The seed contains one external party (*Northstar Partners*, booked on Visual Design), hidden by default.

1. On the Schedule, note there is **no External band** at the bottom — only the real people. The external's bar (Visual Design) is not drawn.
2. Open **Resources** (sidebar). There is **no "External" section** and **no "Add external party" button** — only the people list.
3. Open **Settings** (sidebar). In the **External** section, read the explainer copy and find the **Show external resources** switch — it's **off**.
4. Switch it **on**.
5. Return to **Resources**: the **External** section now appears (with the same explainer copy and an **Add external party** button), showing the seeded external *Northstar Partners*.
6. Return to **Schedule**: a neutral **External / 3rd party** band now appears at the very bottom with *Northstar Partners*'s Visual Design bar (no hours, no utilisation chip).
7. Switch it back **off** in Settings — the external disappears again everywhere; its data is intact.
8. (Optional) Reload the page and re-pick **Studio North**: the choice is remembered (it's stored on the company).

## Acceptance criteria
- The **External** section appears in Settings with explainer copy and a single **Show external resources** switch (`role="switch"`, accessible name `Show external resources`).
- The switch defaults to **off** (`aria-checked="false"`) — externals are hidden out of the box.
- With it **off**: no External band appears on the schedule, no external option appears in the assignee picker or the ⌘K command palette, and the Resources page hides its **External** section and **Add external party** button. The (now-empty) External band header does **not** render. A dataset that already contains externals **hides** them — it never errors.
- With it **on**: the External band renders at the bottom of the schedule (single neutral colour, no utilisation / over-markers), and the **External** section appears under the Resources tab with explainer copy. The assignee picker labels an external **"<Company> (external)"**.
- Editing an allocation that already targets an external keeps that external selectable in the assignee picker even while the pref is off, so editing never silently reassigns the work.
- The choice survives a reload (stored **per-account** as `externalEnabled` on the Account, absent = off) and is carried in Export JSON like other account settings.
