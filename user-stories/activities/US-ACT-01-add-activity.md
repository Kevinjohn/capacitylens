# US-ACT-01 — Add an activity (internal, repeatable, or under a project)

**Area:** Activities · **Persona:** Studio manager · **Linked E2E:** `e2e/activities.spec.ts` → "adds an internal, a repeatable, and a project activity into their three sections"

## Goal
Add an activity of any of the three kinds — **Project**, **Internal**, or **Repeatable** — so it can be picked when allocating.

## Why
An activity is a unit of work people get allocated to. Most belong to a project, so the allocation traces back to a client and project. But internal work (Admin, internal review) isn't tied to a client, and some work recurs across projects (Design, Workshop) — a *repeatable* activity used on many projects. The kind drives where the activity lives on the Activities page and how the schedule's activity lens groups it.

## How (end-to-end)
**Precondition:** Seeded app open; click **Activities** in the sidebar (`/activities`). Projects *Project Lightning* and *Brand Themes* exist. The page shows three sections: **Internal activities**, **Repeatable activities**, **Project activities**.
1. Click **Add activity**. The "Add activity" dialog opens with an **Activity kind** radiogroup (default **Project**).
2. Fill **Name** = `Internal sync`, click the **Internal** kind. The **Project** field disappears. Click **Save**.
3. Click **Add activity**; **Name** = `Discovery workshop`, click **Repeatable**, **Save**.
4. Click **Add activity**; **Name** = `Spec review`, leave kind **Project**, choose **Project** = *Project Lightning*, **Save**.
5. Open the **Schedule** (`/`), start an allocation against a resource, choose *Project Lightning*, and open the **Activity** picker.

## Acceptance criteria
- ✅ **Internal sync** saves into the **Internal activities** section (testid `internal-activities`), with **no** project label.
- ✅ **Discovery workshop** saves into the **Repeatable activities** section (testid `repeatable-activities`).
- ✅ **Spec review** saves into the **Project activities** section (testid `project-activities`), its row labelled with the client · project.
- ✅ Saving an empty **Name** is rejected (required-field error; the dialog stays open).
- ✅ Saving a **Project**-kind activity with **no project chosen** is rejected ("A project activity must be assigned to a project."); the dialog stays open.
- ✅ When allocating with *Project Lightning* chosen, project activities **plus** internal/repeatable activities are selectable in the **Activity** picker.
