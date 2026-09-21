# US-NAV-10 — Sign in before using the app (auth-gated deploy)

**Area:** Navigation / Auth · **Persona:** Tester on an auth-enabled deploy · **Linked E2E:** `e2e/login.auth.spec.ts` (auth-backed project) → "unauthenticated visit shows the login screen, not the app", "signing in reveals the app; signing out from Account returns to the login screen", "the --create-owner-admin-admin bootstrap credential signs in through the real form"

> **Flag-gated; not reachable in the default deploy.** The login screen only exists when
> the optional server runs with `SMALLSASS_ACCOUNT_MODE=password` (or `sso`) — the controlled-demo
> deploy keeps `SMALLSASS_ACCOUNT_MODE` unset (off), where every request carries a synthetic demo
> identity and no login UI exists. The dedicated Playwright `auth-backed` project boots a
> server with the flag on to run this story's checks; it cannot be exercised against
> `pnpm run dev`.

## Goal

Be the only kind of visitor who can read or change data on an auth-enabled deploy: one
who has signed in — and be able to sign out again from Account.

## Why

Phase 3 wires sessions in so turning real auth on later is a config change, not a
re-architecture. The login screen is the user-visible end of that seam: a 401 from
`GET /api/auth/me` must wall off the entire app (no company picker, no data), and a valid
session must restore exactly the normal flow.

## How (end-to-end, password mode)

**Precondition:** a deploy with `SMALLSASS_ACCOUNT_MODE=password`, and a user account created.
On a **fresh password-mode instance with zero users** the login wall instead shows the one sign-up form
that exists — **Setup the account Owner** (see REFERENCE.md “First-run owner setup”). The one-time
setup value authorises first-owner setup but does not create a company. Success continues to **Set up your
company**. A company-login installation uses its configured provider and bootstrap-listed verified
email instead of this password form. Once any user exists,
self-registration closes automatically and only the Sign in form below is reachable. See
[Configuration](/self-hosting/configuration#sign-in-mode) for the secure token handoff and removal.

1. Open the app URL. Instead of the company picker, a **Sign in** screen appears.
2. Enter a wrong password → an inline error appears; you stay on the screen.
3. Enter the correct **Email** and **Password**, press **Sign in** (or Enter).
4. The app loads as normal: company picker → pick a company → scheduler.
5. Go to **Account**. It shows the signed-in email and the available personal security controls.
6. On **Account**, click **Sign out** → you are back on the Sign in screen; reloading stays signed out.

## Acceptance criteria

- Unauthenticated: the Sign in screen replaces the whole app — no company picker, no nav,
  no data; direct API reads (e.g. `GET /api/state`) return 401.
- The form submits with Enter; a failed sign-in shows an inline alert and no navigation.
- When either the experimental Google provider or a strict OIDC provider explicitly branded as
  Google is configured, its action is visibly Google-branded, remains sharp on high-density
  displays without an outer wrapper shadow, and is named exactly **Sign in with Google**
  (including while disabled during the provider hand-off).
- In mixed password mode with Google configured, **Sign in with Google** is the first sign-in
  action, with breathing room from helper copy above and the explicit **or use your password**
  separator below. The password form follows the separator at the standard form spacing. SSO-only
  mode still omits password controls, while password-only mode and other providers retain their
  existing order.
- A strict OIDC label does not select presentation: an OIDC provider labelled Google remains generic
  unless its brand is explicitly set, and its sign-in continues through strict OIDC in either case.
- A successful sign-in resumes the normal company flow: the picker lists the user's memberships;
  when none are available, the documented first-company or invitation path is shown instead.
- Account shows the signed-in identity and personal security controls only while signed in on an
  auth-enabled deploy; it never exposes credential controls with auth off or in local mode.
- Password-mode first-Owner signup uses **name**, **email**, **Create a password** and
  **Owner setup token** under the **Setup the account Owner** heading. Password length and token
  validation remain enforced, while the token field gives the installer handoff instructions. It
  distinguishes the personal sign-in and installation setup from the company
  created afterward; a company-login installation uses its provider route instead.
- Account presents Sign out as a red action aligned to the right of the identity card; using it
  invalidates the session (subsequent loads show Sign in again).
- The Sign in screen passes an axe accessibility audit (no serious/critical violations).
