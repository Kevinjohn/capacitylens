# US-CLI-04 — The built-in "Internal" client

**Area:** Clients · **Persona:** Studio manager · **Linked E2E:** `e2e/internal-client.spec.ts`

## Goal
Use the built-in **Internal** client to capture project-less internal work (Admin, retros, reusable
activities) and see it on the schedule — without it cluttering the Clients management list as if it
were a client you maintain by hand.

## Why
Not all work belongs to a paying client. Floaty gives every account ONE built-in **Internal**
pseudo-client so project-less internal/repeatable activities have a home in the client view: they
bucket under Internal for labelling and filtering, and Internal can also own real projects when the
team wants to. But Internal is a behind-the-scenes data anchor, not a client you manage — so it is
**hidden from the Clients management list** while staying fully selectable and bindable everywhere it
is actually used.

## How (end-to-end)
**Precondition:** Seeded app open.
1. Click **Clients** in the sidebar (`/clients`). The list shows *Acme Inc.* and *Globex* (each with
   Edit / Delete). **Internal does NOT appear here** — it's a hidden data anchor, not a managed client.
2. Click **Projects** in the sidebar (`/projects`). Click **Add project**, set **Name** =
   `Quarterly planning`, open the **Client** picker — **Internal is offered** — choose it, and **Save**.
   The new project shows **· Internal** as its client even though Internal isn't in the Clients list.
3. Click **Activities** in the sidebar (`/activities`). Click **Add activity**, set **Name** =
   `Team retro`, choose the **Internal** kind (the **Project** picker disappears), and **Save** — the
   activity lands in the **Internal activities** section with no project.
4. Click **Schedule** (`/`). Widen to **4w** and scroll to the start so the seed's project-less
   repeatable *Design* booking (Alex Rivera, 8–10 June) is visible.
5. Open **Filter by client** and choose **Internal** (it's still an option here).

## Acceptance criteria
- ✅ **Internal does NOT appear** in the Clients management list (`/clients`); normal clients
  (*Acme Inc.*, *Globex*) are listed with their Edit/Delete controls.
- ✅ Internal is still **selectable as a project's client** in the project form's **Client** picker,
  and a project bound to Internal resolves its client label to **Internal** in the Projects list.
- ✅ Internal remains a valid **Filter by client → Internal** option and a **Clients** entry in the
  ⌘K command palette.
- ✅ An activity created with the **Internal** kind has **no project** and appears under
  **Internal activities** — no error anywhere downstream.
- ✅ **Filter by client → Internal** shows project-less (internal/repeatable) work AND any work under
  Internal-owned projects, while hiding project work owned by other clients (e.g. *Brand System*
  under Globex disappears).
