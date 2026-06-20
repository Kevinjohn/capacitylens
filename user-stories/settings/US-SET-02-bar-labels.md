# US-SET-02 — Choose what allocation bars say

**Area:** Settings · **Persona:** Studio manager · **Linked E2E:** `e2e/settings-bar-labels.spec.ts` → "bars show client and project before the activity by default", "switches in Settings default on and strip the client, then the project, from bars"

## Goal
Decide whether each bar on the schedule names its client and/or project before the activity, so the helicopter view carries as much (or as little) context as the studio wants.

## Why
At a glance, "Wireframes" alone doesn't say *whose* wireframes. Prefixing the client and
project makes a busy schedule self-describing; a studio with one client per person may
prefer to switch the prefixes off and keep bars short. The choice is per-browser (like the
theme), not shared account data.

## How (end-to-end)
**Precondition:** Seeded app open on the Schedule (clock inside the seed window — see *Seed data* in REFERENCE.md).

1. Find Tyler's **Wireframes** bar. Its label reads **Acme Inc. · Project Lightning · Wireframes · 8h**.
2. Open **Settings** (sidebar). In the **Allocation bars** section, find the **Show client name** and **Show project name** switches — both on.
3. Switch **Show client name** off.
4. Return to **Schedule**. The bar now reads **Project Lightning · Wireframes · 8h**.
5. Back in **Settings**, switch **Show project name** off too.
6. Return to **Schedule**. The bar now reads just **Wireframes · 8h**.

## Acceptance criteria
- The Allocation bars section appears between Calendar and Utilisation in Settings.
- Both switches default to **on** (`aria-checked="true"`).
- With both on, a bar's label is `Client · Project · Activity` (then `· Nh` outside blocks mode).
- Switching **Show client name** off removes only the client part; **Show project name** off removes only the project part; both off leaves just the activity.
- An activity with no project shows no empty separators — missing parts are skipped.
- The choice survives a reload in the same browser (device-global `floaty/barLabelPrefs`), and is **not** included in Export JSON.
