# US-RES-09 — A resource's colour comes from its discipline

**Area:** Resources · **Persona:** Studio manager · **Linked E2E:** `e2e/resources.spec.ts` → "adds a person and shows them in the list and schedule"

## Goal
A resource (person or placeholder) is colour-coded **by its discipline**, so everyone in
the same discipline reads as one group on the schedule — without the manager having to
pick a colour per person.

## Why
On a busy timeline, grouping by discipline colour is how a manager scans "who's design vs.
dev" at a glance. Deriving the colour from the discipline keeps a whole team visually
coherent and removes a per-resource decision (and the "is this a valid hex" failure mode).
Discipline, client and project colours are still chosen explicitly via the swatch picker;
a resource simply inherits.

## How (end-to-end)
**Precondition:** Seeded app open; click **Resources** in the sidebar.
1. Add or edit a resource and assign it a **Discipline** (e.g. *Design*).
2. Save. On the **Schedule**, the resource's avatar and the colour cues for its row follow
   that discipline's colour.
3. Change the discipline's colour (Disciplines → Edit → **Colour** swatch); the resource's
   colour on the schedule follows.

## Acceptance criteria
- ✅ The **Resource** form has **no** colour control — there is nothing to pick or type.
- ✅ A resource's displayed colour is derived from its assigned discipline (a stable
  neutral fallback is used when it has no discipline).
- ✅ Changing a discipline's colour updates the colour of every resource in that discipline,
  with no per-resource edit.

## Notes
The discipline/client/project swatch picker (`ColorField`) guarantees a valid stored hex,
so resources never carry a malformed colour. (Earlier drafts of this story described a
per-resource hex picker; the product since moved to discipline-derived colour — this file
reflects the shipped behaviour. See `DECISIONS.md`, 2026-06-01.)
