# US-SET-11 — Viewer read-only mode (server + auth-on)

**Area:** Access / whole-app · **Persona:** A Viewer member (read-only) · **Linked E2E:** `e2e/viewer.auth.spec.ts` → "a viewer sees no edit affordances; an editor does; a direct viewer write is 403"

## Goal
A member whose account role is **Viewer** sees the whole app **read-only**: no create / edit / delete
affordances anywhere, no scheduler drawing / dragging / resizing, no Draw-mode toggle and no
Undo/Redo, and a small **"View only"** indicator. An Owner / Admin / Editor sees every affordance,
exactly as before.

## Why
On an auth-enabled, server-backed deploy, access to a company is a real membership (a role per login).
A Viewer is read-only by definition, so showing them edit buttons they can't use is misleading — and
worse, an optimistic local edit that the server then rejects (403) would desync what they see from
what's stored. So the client hides every edit affordance for a Viewer (UX) and the store refuses a
viewer's mutation locally (defense-in-depth). The **server 403** remains the authoritative access
boundary — the client gating is a courtesy + a desync guard, never the security boundary.

**Critical invariant:** in the **default deploy (auth off)** or **local mode** there is no membership
role to enforce, so the role resolves to `null` → **fully editable**, byte-identical to today. The
read-only mode is reachable ONLY on a server + auth-on deploy where a real `viewer` membership exists.

## How (end-to-end)
**Precondition:** The app runs in server mode (`VITE_CAPACITYLENS_API` set) against a server with
`CAPACITYLENS_AUTH=password`. Owner A has created a company and invited **Viewer V** and **Editor E**
(both accepted). 

**As V (viewer):** sign in, pick the company, dismiss the intro.
1. The sidebar footer shows a subtle **"View only"** badge (`data-testid="view-only"`) beside the
   company name.
2. Open **Clients** (sidebar). There is **no "Add client"** button, and no client row carries an
   **Edit** or **Delete** button. (The same holds on every entity list — Resources, Projects,
   Activities, Disciplines, Time off — one gate covers them all.)
3. Open **Schedule**. The toolbar shows navigation (Prev/Today/Next, the date input, the week-zoom
   group) and the filters, but **no Draw-mode toggle** and **no Undo/Redo** buttons. Each resource
   row has **no "+"**; hovering a lane shows **no "+"** hint; a click or drag on a lane **creates
   nothing**; allocation bars have **no resize grips** and can't be dragged, resized, or opened for
   editing (they still show their hover/focus detail popover — a read).

**As E (editor) for contrast:** sign in, pick the same company.
4. There is **no "View only"** badge; **Clients** shows **Add client**; the Schedule toolbar shows the
   **Draw mode** toggle and **Undo**/**Redo**; bars are fully draggable/resizable.

## Acceptance criteria
- The role drives the UI ONLY on a server + auth-on deploy. `GET /api/accounts` returns
  `{ id, name, role }` per account (the caller's role; **OFF mode** tags every entry `'owner'`).
- For a **Viewer**: no top **Add X** on any list; no row **Edit**/**Delete**; no empty-state create
  CTA; no scheduler per-row **+**, lane draw, or hover **+** hint; allocation bars have **no resize
  grips**, no drag/resize, no edit modal (a viewer bar is `role="img"`, not `button`); the toolbar
  hides the **Draw-mode** toggle and **Undo/Redo**; a **"View only"** badge (`data-testid="view-only"`)
  shows in the sidebar footer.
- For an **Owner/Admin/Editor**: every affordance is shown (no badge), unchanged from before.
- The **server 403** is the authoritative backstop: a direct scheduling write as a Viewer
  (`PUT /api/<entity>/<id>` with the account's `accountId`, write tier = editor+) is **403** even if
  the UI is bypassed. As a second local guard, the store no-ops a viewer's `add*`/`update*`/`delete*`/
  `importData` and surfaces *"Read-only — you don't have edit access."*
- **Default-editable invariant:** in **auth off** (the default everywhere) or **local mode** the role
  is `null` → the app is **fully editable**, byte-identical to today (no badge, every affordance shown).
- UI: `src/auth/PermissionProvider.tsx` + `src/auth/permissionContext.ts` (`useRole`/`useCanEdit`, off
  the pure `can`); story `user-stories/settings/US-SET-11-viewer-readonly.md`; spec
  `e2e/viewer.auth.spec.ts`.
