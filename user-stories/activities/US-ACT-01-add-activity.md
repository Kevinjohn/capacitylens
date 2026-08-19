# US-ACT-01 — Add an activity (internal, all-projects, or project-specific)

**Area:** Activities · **Persona:** Studio manager · **Linked E2E:** `e2e/activities.spec.ts` → "adds an internal, an all-projects, and a project-specific activity into their three sections", "groups and sorts project activities by client, project, then activity"

## Goal

Add an activity of any of the three kinds — **Project-specific**, **Internal**, or **All projects** — so it can be picked when allocating.

## Why

An activity is a unit of work people get allocated to. Most belong to a project, so the allocation traces back to a client and project. But internal work (Admin, internal review) isn't tied to a client, and some work is shared across projects (Design, Workshop) — an _All projects_ activity usable on any project. The booking records the chosen project, not the shared activity.

## How (end-to-end)

**Precondition:** Seeded app open; click **Activities** in the sidebar (`/activities`). Projects _Project Watchtower_ and _Metropolis Rebrand_ exist. The page shows three sections: **Internal activities**, **All-projects activities**, **Project-specific activities**.

1. Click **Add activity**. The "Add activity" dialog opens with an **Activity kind** radiogroup ordered
   **Internal**, **All projects**, **Project-specific** (default **Project-specific**).
2. Fill **Name** = `Internal sync`, click the **Internal** kind. The **Project** field disappears. Click **Save**.
3. Click **Add activity**; **Name** = `Discovery workshop`, click **All projects**, **Save**.
4. Click **Add activity**; **Name** = `Spec review`, leave kind **Project-specific**, choose **Project** = _Project Watchtower_, **Save**.
5. Open the **Schedule** (`/`) and start an allocation against a resource. Choose _Project Watchtower_ and open the **Activity** picker; it offers **Discovery workshop** in the **All projects** group before that project's activities, including **Spec review**. Choose **No specific project** to see only All-projects activities without attributing the booking.

## Acceptance criteria

- ✅ **Internal sync** saves into the **Internal activities** section (testid `internal-activities`),
  with **no** project label. Internal activities are alphabetical.
- ✅ **Activity kind** is ordered **Internal**, **All projects**, **Project-specific**, while
  **Project-specific** remains selected by default.
- ✅ **Discovery workshop** saves into the **All-projects activities** section (testid
  `cross-project-activities`). All-projects activities are alphabetical.
- ✅ **Spec review** saves into the **Project-specific activities** section (testid
  `project-specific-activities`). Project-specific work is grouped and sorted by **client → project
  → activity**; each client and project label appears once above its activity rows.
- ✅ A project activity whose scoped project or client metadata is unavailable remains visible in a
  clearly labelled fallback group rather than disappearing or crashing the list.
- ✅ Saving an empty **Name** is rejected (required-field error; the dialog stays open).
- ✅ Saving a **Project-specific**-kind activity with **no project chosen** is rejected ("A project-specific activity must be assigned to a project."); the dialog stays open.
- ✅ With _Project Watchtower_ chosen, the **Activity** picker offers **Discovery workshop** in an **All projects** group first and **Spec review** in a **Project-specific** group.
- ✅ With **Internal** chosen, the **Activity** picker offers **Internal sync**; with **No specific project** chosen, it offers the All-projects **Discovery workshop**.
