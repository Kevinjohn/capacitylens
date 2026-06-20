# US-CLI-04 — The built-in "Internal" client

**Area:** Clients · **Persona:** Studio manager · **Linked E2E:** `e2e/internal-client.spec.ts`

## Goal
Use the built-in **Internal** client to capture project-less internal work (Admin, retros, reusable
activities) and see it on the schedule, without inventing a fake "Internal" client by hand.

## Why
Not all work belongs to a paying client. Floaty gives every account ONE built-in **Internal**
pseudo-client so project-less internal/repeatable activities have a home in the client view: they
bucket under Internal for labelling and filtering, and Internal can also own real projects when the
team wants to. It's protected (one per account, never renamed or deleted) so the bucket is stable.

## How (end-to-end)
**Precondition:** Seeded app open.
1. Click **Clients** in the sidebar (`/clients`). The list shows **Internal** (tagged **Built-in**),
   alongside *Acme Inc.* and *Globex*.
2. Note the **Internal** row has **no Edit / Delete** buttons (the affordances are hidden; the store
   also rejects renaming or deleting it).
3. Click **Activities** in the sidebar (`/activities`). Click **Add activity**, set **Name** =
   `Team retro`, choose the **Internal** kind (the **Project** picker disappears), and **Save** — the
   activity lands in the **Internal activities** section with no project.
4. Click **Schedule** (`/`). Widen to **4w** and scroll to the start so the seed's project-less
   repeatable *Design* booking (Alex Rivera, 8–10 June) is visible.
5. Open **Filter by client** and choose **Internal**.

## Acceptance criteria
- ✅ **Internal** appears in the Clients list, tagged **Built-in**, with **no Edit/Delete** controls
  (normal clients keep theirs).
- ✅ An activity created with the **Internal** kind has **no project** and appears under
  **Internal activities** — no error anywhere downstream.
- ✅ **Filter by client → Internal** shows project-less (internal/repeatable) work AND any work under
  Internal-owned projects, while hiding project work owned by other clients (e.g. *Brand System*
  under Globex disappears).
- ✅ The Internal client is selectable wherever clients are listed (Clients list, Project form's
  **Client** picker, **Filter by client**, the ⌘K command palette's Clients section).
