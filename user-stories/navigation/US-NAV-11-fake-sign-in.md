# US-NAV-11 — Demo sign-in before picking a company (cosmetic, default deploy)

**Area:** Navigation & shell · **Persona:** Owner demoing the app to a stakeholder · **Linked E2E:** `e2e/fake-signin.spec.ts` → "precedes the company picker; signing in reveals it, then the app", "staying signed in persists across reload; Sign out returns to the demo sign-in", "has no serious or critical accessibility violations"

> **Cosmetic — not real authentication.** This is a Google-style *"Choose an account"* screen
> shown purely to preview the intended "log in first, then pick a company" flow. No account,
> password, session, or popup exists, and it gates **no** data. The real, server-authoritative
> login wall is **US-NAV-10** (flag-gated); this demo screen is mounted only when that real auth
> is **off** (`authMode === 'off'`), so the two never both appear.

## Goal
Open CapacityLens and see a believable "sign in first" step before the company picker, so a viewer
understands the planned shape of the product (auth → choose a workspace → plan).

## Why
Real auth (Better Auth) is wired but off in the alpha. Before it's switched on, the owner wants
to *show* the intended journey without standing up auth. A cosmetic screen does that — and stays
strictly separate from the real seam (it disappears the moment real auth is enabled).

## How (end-to-end, default local mode)
**Precondition:** Seeded app in the default deploy (no `VITE_CAPACITYLENS_API`, or a server with auth
off). Start from a clean state (DevTools → Console → `localStorage.clear()` → reload).

1. Open the app. The first screen is **Choose an account** — a Google-style card with the
   **Jordan Avery** account (avatar, name, email) and a **Use another account** row.
2. Click the account. With no password and no popup, you advance to the **company picker**
   ("Choose a company"), which now reads **Signed in as Jordan Avery** with a **Sign out** link.
3. Pick **Studio North** → the scheduler loads as normal.
4. Reload the tab → you skip the demo sign-in and land straight on the company picker (the
   "signed in" choice persists per-browser).
5. From the picker (or the sidebar's **Sign out** once in the app), click **Sign out** → you are
   back on the **Choose an account** screen, and a reload stays there.

## Acceptance criteria
- The **Choose an account** screen appears **before** the company picker on a clean load; the
  picker is not present until you continue.
- Clicking the account (or "Use another account") advances to the picker — no popup, no password.
- The picker shows **Signed in as Jordan Avery** and a working **Sign out**.
- Being signed in **persists across reload** (you skip the demo sign-in); **Sign out** returns to
  it and that also persists across reload.
- The demo sign-in is **never** shown when the real auth wall is on (US-NAV-10) — the two don't
  stack.
- The **Choose an account** screen passes an axe accessibility audit (no serious/critical
  violations), in light and dark.
