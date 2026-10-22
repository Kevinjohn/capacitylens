# US-SET-11 — Viewer read-only mode (server + auth-on)

**Area:** Access / whole-app · **Persona:** A Viewer member (read-only) · **Linked E2E:** `e2e/viewer.auth.spec.ts` → "a viewer sees no edit affordances; an editor does; a direct viewer write is 403"

## Goal

A member whose account role is **Viewer** sees the whole app **read-only**: no create / edit / delete
affordances anywhere, no scheduler drawing / dragging / resizing, no Draw-mode toggle and no
Undo/Redo, and a small **"View only"** indicator. Every access level has a persistent role badge
beside the company name; Owner/Admin/Editor keep their permitted edit affordances.

## Why

On an auth-enabled, server-backed deploy, access to a company is a real membership (a role per login).
A Viewer is read-only by definition, so showing them edit buttons they can't use is misleading — and
worse, an optimistic local edit that the server then rejects (403) would desync what they see from
what's stored. So the client hides every edit affordance for a Viewer (UX) and the store refuses a
viewer's mutation locally (defense-in-depth). The **server 403** remains the authoritative access
boundary — the client gating is a courtesy + a desync guard, never the security boundary.

**Critical invariant:** every persisted server has authenticated membership roles, and a Viewer is
read-only. The in-memory demo has no member roles, remains editable and is labelled **Demo access**.

## How (end-to-end)

**Precondition:** The app runs in its default server mode against a server with
`CAPACITYLENS_MODE=password-only`. Same-origin `/api` needs no frontend API setting; set
`VITE_CAPACITYLENS_API` only when the API uses a different origin. Owner A has created a company and
invited **Viewer V** and **Editor E** (both accepted).

**As V (viewer):** sign in and pick the company. Dismiss the non-blocking product orientation if
it is open.

1. The sidebar footer shows the company block — name and role badge — without a company switch
   action. V can also read their role on **Settings → Team & access → Your access**. The block
   carries a subtle pill-shaped **"View only"** badge
   (`data-testid="view-only"`).
2. Open **Clients** (sidebar). There is **no "Add client"** button, and no client row carries an
   **Edit** or **Delete** button. (The same holds on every entity list — Resources, Projects,
   Activities, Disciplines, Time off — one gate covers them all.)
3. Open **Schedule**. The toolbar shows navigation (Prev/Today/Next, the date input, the week-zoom
   group) and the filters, but **no Draw-mode toggle** and **no Undo/Redo** buttons. Each resource
   row has **no "+"**; hovering a lane shows **no "+"** hint; a click or drag on a lane **creates
   nothing**; allocation bars have **no resize grips** and can't be dragged, resized, or opened for
   editing (they remain Tab-reachable and show their hover/focus detail popover — a read). That
   Viewer popover says **Read-only allocation details**, and the bar's assistive label includes the
   complete project/client and note detail without offering edit gestures.

**As E (editor) for contrast:** sign in, pick the same company. 4. The footer badge says **Editor** without the **View only** qualifier; **Clients** shows **Add
client**; the Schedule toolbar shows the **Draw mode** toggle and **Undo**/**Redo**; bars are fully
draggable/resizable.

## Acceptance criteria

- The role drives the UI on every persisted server. `GET /api/accounts` returns
  `{ id, name, role }` per account (the caller's role).
- For a **Viewer**: no top **Add X** on any list; no row **Edit**/**Delete**; no empty-state create
  CTA; no scheduler per-row **+**, lane draw, or hover **+** hint; allocation bars have **no resize
  grips**, no drag/resize, no edit modal (a viewer bar is a Tab-reachable `role="img"`, not
  `button`, with complete read-only detail and no edit instructions); the toolbar hides the
  **Draw-mode** toggle and **Undo/Redo**.
- The sidebar company block — company name, role badge (`data-testid="active-role"`) and **View
  only** badge (`data-testid="view-only"`) — is shown without a company switch action.
- For an **Owner/Admin/Editor**: every permitted affordance is shown, and where the company block
  renders it displays the effective pill-shaped role badge; only Viewer adds the **View only**
  qualifier.
- The **server 403** is the authoritative backstop: a direct scheduling write as a Viewer
  (`PUT /api/<entity>/<id>` with the account's `accountId`, write tier = editor+) is **403** even if
  the UI is bypassed. As a second local guard, the store no-ops a viewer's `add*`/`update*`/`delete*`/
  `importData` and surfaces _"Read-only — you don't have edit access."_
- The in-memory demo has no persisted badge or membership role and remains editable; it identifies
  its access posture as **Demo access**.
- UI: `src/auth/PermissionProvider.tsx` + `src/auth/permissionContext.ts` (`useRole`/`useCanEdit`, off
  the pure `can`); story `user-stories/settings/US-SET-11-viewer-readonly.md`; spec
  `e2e/viewer.auth.spec.ts`.
