# US-ACT-01 — Add an activity (internal, cross-project, or project-specific)

**Area:** Activities · **Persona:** Studio manager · **Linked E2E:** `e2e/activities.spec.ts` → "adds an internal, a cross-project, and a project-specific activity into their three sections"

## Goal
Add an activity of any of the three kinds — **Project-specific**, **Internal**, or **Cross-project** — so it can be picked when allocating.

## Why
An activity is a unit of work people get allocated to. Most belong to a project, so the allocation traces back to a client and project. But internal work (Admin, internal review) isn't tied to a client, and some work is shared across projects (Design, Workshop) — a *cross-project* activity usable on many projects. The kind drives where the activity lives on the Activities page and how the schedule's activity lens groups it.

## How (end-to-end)
**Precondition:** Seeded app open; click **Activities** in the sidebar (`/activities`). Projects *Project Lightning* and *Brand Themes* exist. The page shows three sections: **Internal activities**, **Cross-project activities**, **Project-specific activities**.
1. Click **Add activity**. The "Add activity" dialog opens with an **Activity kind** radiogroup (default **Project-specific**).
2. Fill **Name** = `Internal sync`, click the **Internal** kind. The **Project** field disappears. Click **Save**.
3. Click **Add activity**; **Name** = `Discovery workshop`, click **Cross-project**, **Save**.
4. Click **Add activity**; **Name** = `Spec review`, leave kind **Project-specific**, choose **Project** = *Project Lightning*, **Save**.
5. Open the **Schedule** (`/`), start an allocation against a resource, choose *Project Lightning*, and open the **Activity** picker.

## Acceptance criteria
- ✅ **Internal sync** saves into the **Internal activities** section (testid `internal-activities`), with **no** project label.
- ✅ **Discovery workshop** saves into the **Cross-project activities** section (testid `cross-project-activities`).
- ✅ **Spec review** saves into the **Project-specific activities** section (testid `project-specific-activities`), its row labelled with the client · project.
- ✅ Saving an empty **Name** is rejected (required-field error; the dialog stays open).
- ✅ Saving a **Project-specific**-kind activity with **no project chosen** is rejected ("A project-specific activity must be assigned to a project."); the dialog stays open.
- ✅ When allocating with *Project Lightning* chosen, project-specific activities **plus** internal/cross-project activities are selectable in the **Activity** picker.
