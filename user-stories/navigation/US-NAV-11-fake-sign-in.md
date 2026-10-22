# US-NAV-11 — Demo account picker before choosing a company (cosmetic)

**Area:** Navigation & shell · **Persona:** Owner demoing the app to a stakeholder · **Linked E2E:** `e2e/fake-signin.spec.ts` → "precedes the company picker; signing in reveals it, then the app", "staying signed in persists across reload; Sign out returns to the demo sign-in", "has no serious or critical accessibility violations"

> **Cosmetic — not real authentication.** This is a Google-style _"Choose an account"_ screen
> shown purely to preview the intended "log in first, then pick a company" flow. No account,
> password, session, or popup exists, and it gates **no** data. The real, server-authoritative
> login wall is **US-NAV-10**. This demo screen is mounted only in the explicit in-memory demo
> build, so the two never both appear.

## Goal

Open CapacityLens and see a believable "sign in first" step before the company picker, so a viewer
understands the planned shape of the product (auth → choose a workspace → plan).

## Why

The sample account picker makes the demo easy to explore while keeping it distinct from persisted
server access. It creates no account or session, and its scheduling data remains temporary.

## How (end-to-end, in-memory demo)

**Precondition:** Seeded app with `VITE_CAPACITYLENS_DEMO=1`. Start from a clean state (DevTools →
Console → `localStorage.clear()` → reload).

1. Open the app. The first screen is **Choose an account** — a Google-style card with the
   **Bruce Wayne** account (avatar, name, email) and a **Use another account** row.
2. Click the account. With no password and no popup, you advance to the **company picker**
   ("Choose a company"), which now reads **Signed in as Bruce Wayne** with a **Sign out** link.
3. Pick **Wayne Enterprises** → the scheduler loads as normal.
4. Reload the tab → you skip the demo sign-in and land straight on the company picker (the
   "signed in" choice persists per-browser).
5. From the picker (or **Account** once in the app), click **Sign out** → you are
   back on the **Choose an account** screen, and a reload stays there.

## Acceptance criteria

- The **Choose an account** screen appears **before** the company picker on a clean load; the
  picker is not present until you continue.
- Clicking the account (or "Use another account") advances to the picker — no popup, no password.
- The picker shows **Signed in as Bruce Wayne** and a working **Sign out**.
- Being signed in **persists across reload** (you skip the demo sign-in); **Sign out** returns to
  it and that also persists across reload.
- The demo sign-in is **never** shown when the real auth wall is on (US-NAV-10) — the two don't
  stack.
- The **Choose an account** screen passes an axe accessibility audit (no serious/critical
  violations), in light and dark.
