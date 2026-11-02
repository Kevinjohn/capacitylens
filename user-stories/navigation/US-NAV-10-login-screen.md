# US-NAV-10 — Sign in before using persisted server data

**Area:** Navigation / Auth · **Persona:** Member of a company on a persisted server · **Linked E2E:** `e2e/login.auth.spec.ts` (auth-backed project) → "unauthenticated visit shows the login screen, not the app — and the API 401s", "signing in reveals the app; signing out from Account via the sidebar returns to the login screen", "the membership-free administrator signs in through the real form", "a login with NO memberships sees no company data (tenant isolation — no cross-tenant leak)"; `e2e/first-company.auth.spec.ts`

> **Persisted server access.** Every server that stores scheduling data requires a signed-in,
> approved company member. Sign-in is by email and password only. The in-memory demo is a separate,
> no-login experience.

## Goal

Read or change persisted company data only after signing in, and be able to sign out again from
Account.

## Why

The login screen protects the whole app. A 401 from `GET /api/auth/me` must show sign-in before any
company data; a valid session restores the usual flow.

## How (end-to-end)

**Precondition:** a persisted server with a company and a member's password identity. On a fresh
server with no identities, the sign-in screen says the server is not set up yet
(`login-setup-needed`); the installer prints a one-time setup link for the first Owner (see
[First Owner](../../docs-src/owner/create-your-company.md)).

1. Open the app URL. A **Sign in** screen appears instead of the app.
2. Enter a wrong password → an inline error appears; you stay on the screen.
3. Enter the correct **Email** and **Password** and press **Sign in** (or Enter).
4. The app opens the company's scheduler. An identity that is not yet confirmed, approved or a
   member sees only the limited screen for its next step instead.
5. Go to **Account**. It shows the signed-in email and the personal password controls.
6. On **Account**, click **Sign out** → you are back on the Sign in screen; reloading stays signed out.

## Acceptance criteria

- Unauthenticated: the Sign in screen replaces the whole app — no nav, no data; direct API reads
  return 401.
- The form submits with Enter; a failed sign-in shows an inline alert and no navigation.
- Opening or refreshing a nested app URL, including `/account/`, loads the company and planning
  data without returning to the site root.
- There is no Google, Microsoft or other provider action, and no authenticator or recovery-code
  challenge.
- A signed-in identity without a confirmed address sees **Confirm your email** (`access-verify-email`);
  one awaiting approval sees the admission screen (`access-admission`); an approved identity with
  no membership sees the membership screen (`access-membership`). None of them shows company data.
- **Forgot password?** appears only when the server can send email.
- A confirmed password change clears the old form values and ends every session.
- Account presents Sign out as a red action aligned to the right of the identity card; using it
  invalidates the session.
- The Sign in screen passes an axe accessibility audit (no serious/critical violations).

**Guide:** [Account](../../docs-src/using/account.md) and
[Sign-in and access](../../docs-src/company-login/index.md).
