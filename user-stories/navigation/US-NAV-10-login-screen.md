# US-NAV-10 — Sign in before using persisted server data

**Area:** Navigation / Auth · **Persona:** Tester on an auth-enabled deploy · **Linked E2E:** `e2e/login.auth.spec.ts` (auth-backed project) → "unauthenticated visit shows the login screen, not the app", "signing in reveals the app; signing out from Account returns to the login screen", "the --create-owner-admin-admin bootstrap credential signs in through the real form"

> **Persisted server access.** Every server that stores scheduling data requires an authenticated
> company member. `CAPACITYLENS_MODE` selects password and provider options; it does not disable
> authentication. The dedicated Playwright `auth-backed` project boots a server to run this
> story's checks; the in-memory demo is a separate, no-login experience.

## Goal

Read or change persisted company data only after signing in, and be able to sign out again from
Account.

## Why

The login screen protects the whole app on an authentication-enabled deployment. A 401 from
`GET /api/auth/me` must show sign-in before the company picker or company data; a valid session
restores the usual flow.

## How (end-to-end, password mode)

**Precondition:** a deploy with `CAPACITYLENS_MODE=password-only`, and a user account created.
On a **fresh password-mode instance with zero users** the login wall instead shows the one sign-up form
that exists — **Setup the account Owner** (see REFERENCE.md “First-run owner setup”). The one-time
setup value authorises first-owner setup but does not create a company. Success continues to **Set up your
company**. A company-login installation uses Google. The first Google identity must match the
bootstrap email allowlist; signing in creates no company, so the Owner then completes company setup.
Once any user exists,
self-registration closes automatically and only the Sign in form below is reachable. See
[Configuration](../../docs-src/self-hosting/configuration.md#sign-in-mode) for the secure token handoff and removal.

1. Open the app URL. Instead of the company picker, a **Sign in** screen appears.
2. Enter a wrong password → an inline error appears; you stay on the screen.
3. Enter the correct **Email** and **Password**, press **Sign in** (or Enter).
4. The server selects the installation company and the app opens its scheduler. If you have no
   membership, follow the invitation path instead.
5. Go to **Account**. It shows the signed-in email and the available personal security controls.
6. On **Account**, click **Sign out** → you are back on the Sign in screen; reloading stays signed out.

## Acceptance criteria

- Unauthenticated: the Sign in screen replaces the whole app — no company picker, no nav,
  no data; direct API reads (e.g. `GET /api/state`) return 401.
- The form submits with Enter; a failed sign-in shows an inline alert and no navigation.
- Opening or refreshing a nested app URL, including `/account/`, loads the authenticated company and planning data without returning to the site root.
- A confirmed password update clears the old form values even when follow-up cleanup fails; an uncertain response gives recovery guidance without claiming the password stayed unchanged.
- A correct password signs in without a CapacityLens authenticator or recovery-code challenge.
  Google may require MFA under the agency's provider policy; enabling company sign-in alone does not
  enable it.
- When the named Google provider is configured, its action is visibly Google-branded, remains
  sharp on high-density displays without an outer wrapper shadow, and is named exactly **Sign in with Google**
  (including while disabled during the provider hand-off).
- In mixed mode, the configured Google action appears once above the password form with the
  localized **or use your password** separator. In Google-only mode there is no password form or
  separator; in password-only mode there is no provider area.
- The Google action has consistent alignment, recognizable undistorted artwork, and the exact
  **Sign in with Google** accessible name. Keyboard order follows the provider action, then the
  password fields.
- First-owner Google setup accepts only an allowlisted verified address while no user exists. Its
  callback creates a sign-in identity but does not create a company or membership. A later new
  Google identity needs an unused invitation addressed to its verified email.
- Provider errors and pending/disabled states remain visible and accessible.
- A successful sign-in opens the sole server-selected company when the user is an active member;
  when none are available, the documented first-company or invitation path is shown instead.
- Account shows the signed-in identity and personal security controls only while signed in on an
  persisted server; the in-memory demo has no credential controls.
- In mixed mode, **Connect Google** from Account asks for **Confirm it's you** when the session has
  aged. Linking requires a verified local email matching the verified Google address. Cancelling
  leaves the account unconnected; success starts the link once. A further freshness refusal asks
  for a new sign-in. Google identities are never merged by matching email alone.
- Password-mode first-Owner signup uses **name**, **email**, **Create a password** and
  **Owner setup token** under the **Setup the account Owner** heading. Password length and token
  validation remain enforced, while the token field gives the installer handoff instructions. It
  distinguishes the personal sign-in and installation setup from the company
  created afterward; a company-login installation uses the Google route and bootstrap allowlist
  instead.
- Account presents Sign out as a red action aligned to the right of the identity card; using it
  invalidates the session (subsequent loads show Sign in again).
- The Sign in screen passes an axe accessibility audit (no serious/critical violations).

**Guide:** [Account](../../docs-src/using/account.md), [Passwords and company sign-in](../../docs-src/company-login/index.md#passwords-and-company-sign-in),
[Set up Google sign-in](../../docs-src/company-login/set-up-company-login.md) and
[Require company sign-in](../../docs-src/company-login/move-to-single-sign-on.md).
