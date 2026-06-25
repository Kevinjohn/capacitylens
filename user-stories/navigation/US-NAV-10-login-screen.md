# US-NAV-10 — Sign in before using the app (auth-gated deploy)

**Area:** Navigation / Auth · **Persona:** Tester on an auth-enabled deploy · **Linked E2E:** `e2e/login.auth.spec.ts` (auth-backed project) → "unauthenticated visit shows the login screen, not the app", "signing in reveals the app; signing out from Settings returns to the login screen"

> **Flag-gated; not reachable in the default deploy.** The login screen only exists when
> the optional server runs with `CAPACITYLENS_AUTH=password` (or `sso`) — the controlled-demo
> deploy keeps `CAPACITYLENS_AUTH` unset (off), where every request carries a synthetic demo
> identity and no login UI exists. The dedicated Playwright `auth-backed` project boots a
> server with the flag on to run this story's checks; it cannot be exercised against
> `npm run dev`.

## Goal
Be the only kind of visitor who can read or change data on an auth-enabled deploy: one
who has signed in — and be able to sign out again from Settings.

## Why
Phase 3 wires sessions in so turning real auth on later is a config change, not a
re-architecture. The login screen is the user-visible end of that seam: a 401 from
`GET /api/auth/me` must wall off the entire app (no company picker, no data), and a valid
session must restore exactly the normal flow.

## How (end-to-end, password mode)
**Precondition:** a deploy with `CAPACITYLENS_AUTH=password`, and a user account created
(sign-up is API-only this round — there is no sign-up form).

1. Open the app URL. Instead of the company picker, a **Sign in** screen appears.
2. Enter a wrong password → an inline error appears; you stay on the screen.
3. Enter the correct **Email** and **Password**, press **Sign in** (or Enter).
4. The app loads as normal: company picker → pick a company → scheduler.
5. Go to **Settings**. An **Account** section shows the signed-in email with **Sign out**.
6. Click **Sign out** → you are back on the Sign in screen; reloading stays signed out.

## Acceptance criteria
- Unauthenticated: the Sign in screen replaces the whole app — no company picker, no nav,
  no data; direct API reads (e.g. `GET /api/state`) return 401.
- The form submits with Enter; a failed sign-in shows an inline alert and no navigation.
- A successful sign-in lands in the normal app flow (company picker with seeded companies).
- Settings shows the Account section **only** while signed in on an auth-enabled deploy;
  it never appears with auth off or in local mode.
- Sign out invalidates the session (subsequent loads show Sign in again).
- The Sign in screen passes an axe accessibility audit (no serious/critical violations).
