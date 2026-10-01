# US-SET-13 — Password recovery (password-capable modes)

**Area:** Team & access · **Persona:** Studio owner / admin + a locked-out member · **Linked E2E:**
`e2e/reset-password.auth.spec.ts` → "admin mints a reset link in Team & access; the locked-out member
sets a new password with it"

## Goal

Let a locked-out password user recover access using a single-use, 24-hour link without being
signed in. When SMTP is configured, they can request the link by email. An Owner or Admin can
also copy a link from Team & access and share it directly, without email infrastructure.

## Why

Small agencies need password recovery with or without an SMTP service. A reset link grants
access to the target identity, so administrative resets retain their role and freshness checks.
Company-sign-in-only accounts recover credentials through their provider.

See [Account email](../../docs-src/self-hosting/configuration.md#account-email) for setup and use.

## Self-service email

1. On the sign-in screen, choose **Forgot password?** (`forgot-password`).
2. Enter your address (`forgot-password-email`) and choose **Email reset link** (`forgot-password-submit`).
3. The neutral confirmation (`forgot-password-confirmation`) reads: **If an account uses that address,
   we've emailed a reset link.**
4. Open the emailed link, set a new password and sign in. Existing sessions are revoked.

## How (end-to-end)

**Precondition:** Server mode with `SMALLSASS_ACCOUNT_MODE=password-only`. Owner A's company has member B
(editor). B has forgotten their password. Sign in as **A**, pick the company, open **Team & access**.

1. In the **Members** table, A opens the gear on B's row (`data-testid="member-row"` →
   `data-testid="member-menu"`). The **Member actions** menu holds **Reset password**
   (`data-testid="member-reset-password"`).
2. A chooses it and confirms. A block appears with the full link `<origin>/reset-password/<token>`
   (`data-testid="reset-link"`), a visible **Copy** button whose accessible name is
   **Copy reset link for B**, and a note naming **B** and the expiry date — the link is shown
   **once** and never again.
3. A copies the link and sends it to B directly. This administrative operation sends no email.
4. **As B, signed out** — open the link. The **Reset password** page renders (no login wall in
   front of it — B is exactly the person who cannot sign in): **New password**
   (`data-testid="reset-new-password"`), **Confirm new password**
   (`data-testid="reset-confirm-password"`), **Set new password** (`data-testid="reset-submit"`).
5. Mismatched or too-short (under 15 characters) input shows a field error without a request.
6. On success: _"Password updated. Sign in with your new password."_
   (`data-testid="reset-success"`) with a **Go to sign in** link (a full page load onto the login
   wall). B signs in with the new password.
7. The old password no longer signs in, and any session B still had is revoked.

## Acceptance criteria

- **Reset password** appears in the row's gear menu only in server + auth-on **password** mode, only
  for an Owner/Admin, and never on an Owner's row for an Admin (only an Owner may reset an Owner).
  Absent in `sso` mode and in auth-off/local.
- The minted link is **single-use** and **expires in 24 hours**; it is returned exactly once
  (`201 {token, expiresAt}`) and never stored, listed, logged, or shown again.
- `/reset-password/:token` renders **without a session**; redeeming sets the new password via
  Better Auth's public `POST /api/auth/reset-password`.
- Redeeming revokes every existing session for that member; the old password is dead immediately.
- A used/expired/unknown token shows _"This reset link is invalid, already used, or expired. Ask
  your admin for a new one."_ — reusing a consumed token is a server-side **400**.
- The server is the backstop regardless of the UI: minting below admin tier or cross-tenant is
  **403**, an Admin targeting an Owner is **403**, a non-member target is **404**, and `sso`/OFF
  modes answer **400** (`POST /api/accounts/:accountId/members/:userId/reset-password`).
- The public `POST /api/auth/request-password-reset` endpoint is available only when SMTP and
  password sign-in are enabled; otherwise it returns 404. The response never includes a token.
- Registered password users receive one email. Unknown addresses and provider-only accounts
  receive no email and get the same response status and body. SMTP failures are logged without
  an address, token or link; the public confirmation remains neutral.
- Without SMTP, the sign-in screen shows no recovery-email controls. Admin copy-links remain available.
