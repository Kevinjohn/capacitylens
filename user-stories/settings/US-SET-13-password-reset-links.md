# US-SET-13 — Password recovery by email

**Area:** Sign-in · **Persona:** A member who forgot their password · **Automated coverage:**
`apps/backend/tests/functional/auth/recovery.spec.ts`, `ForgotPassword.test.tsx`,
`ResetPassword.test.tsx`

## Goal

Let a locked-out member recover access with a single-use emailed link, without being signed in.

## Why

A small agency has no help desk. Email recovery lets a member fix a forgotten password themselves.
Owners and Admins cannot reset another member's password.

**Guide:** [Passwords and sessions](../../docs-src/company-login/index.md#passwords-and-sessions).

## How (end-to-end)

**Precondition:** a persisted server with email delivery configured, and a member with a password.

1. On the sign-in screen, choose **Forgot password?** (`forgot-password`).
2. Enter your address (`forgot-password-email`) and submit (`forgot-password-submit`).
3. The neutral confirmation (`forgot-password-confirmation`) appears, whether or not the address
   has an account.
4. Open the emailed link. The **Reset password** page renders without a session: **New password**
   (`reset-new-password`), **Confirm new password** (`reset-confirm-password`), **Set new password**
   (`reset-submit`).
5. On success (`reset-success`), sign in with the new password.

## Acceptance criteria

- Without email delivery the sign-in screen shows no recovery controls, and the request endpoint
  answers 404.
- Known and unknown addresses get the same response; only a registered address receives an email.
- The link is single-use and expires after one hour. Opening it does not spend it.
- Setting a new password ends every existing session; the old password stops working at once.
- Mismatched or too-short (under 15 characters) input shows a field error without a request.
- A used, expired or unknown link shows **This reset link is invalid, already used, or expired.
  Request a new one from the sign-in page.**
- The sole Owner who cannot use email recovery is recovered by the hosting operator's
  `owner:reset-password` command, not from the app.
