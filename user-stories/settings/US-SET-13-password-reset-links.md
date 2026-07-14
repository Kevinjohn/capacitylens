# US-SET-13 — Admin-issued password-reset links (password mode)

**Area:** Settings · **Persona:** Studio owner / admin + a locked-out member · **Linked E2E:**
`e2e/reset-password.auth.spec.ts` → "admin mints a reset link in Settings; the locked-out member
sets a new password with it"

## Goal
Let an Owner or Admin get a locked-out member back into the app **without any email
infrastructure**: mint a single-use, 24-hour password-reset link from Settings → Members, hand it
over directly (chat, however), and let the member choose a new password on a page that works
**without being signed in**.

## Why
CapacityLens deliberately has no email delivery (no verification or reset mail — a standing
non-goal), so `password` mode needs a human-scale reset path: for a 5–15 person agency, "ask your
admin" is normal. The link reuses the invite posture — a write-once bearer secret shown exactly
once, never listed or read back — and rides Better Auth's own single-use, expiring verification
store. Because a reset link is an **account-takeover capability** (whoever holds it can sign in as
the target), an Admin can never mint one for an Owner — the same escalation door the
no-admin→owner-grant rule closes elsewhere. This is a **password-mode** feature only: in `sso` the
identity provider owns credentials, and in auth-off there are none.

## How (end-to-end)
**Precondition:** Server mode with `CAPACITYLENS_AUTH=password`. Owner A's company has member B
(editor). B has forgotten their password. Sign in as **A**, pick the company, open **Settings**.

1. In the **Members** section, B's row (`data-testid="member-row"`) shows a **Reset password**
   button (`data-testid="member-reset-password"`).
2. A clicks it. A block appears with the full link `<origin>/reset-password/<token>`
   (`data-testid="reset-link"`), a **Copy** button, and a note naming **B** and the expiry date —
   the link is shown **once** and never again.
3. A copies the link and sends it to B directly. Nothing is emailed by the app.
4. **As B, signed out** — open the link. The **Reset password** page renders (no login wall in
   front of it — B is exactly the person who cannot sign in): **New password**
   (`data-testid="reset-new-password"`), **Confirm new password**
   (`data-testid="reset-confirm-password"`), **Set new password** (`data-testid="reset-submit"`).
5. Mismatched or too-short (< 8 chars) input shows a field error without a request.
6. On success: *"Password updated. Sign in with your new password."*
   (`data-testid="reset-success"`) with a **Go to sign in** link (a full page load onto the login
   wall). B signs in with the new password.
7. The old password no longer signs in, and any session B still had is revoked.

## Acceptance criteria
- **Reset password** appears only in server + auth-on **password** mode, only for an Owner/Admin,
  and never on an Owner's row for an Admin (only an Owner may reset an Owner). Absent in `sso`
  mode and in auth-off/local.
- The minted link is **single-use** and **expires in 24 hours**; it is returned exactly once
  (`201 {token, expiresAt}`) and never stored, listed, logged, or shown again.
- `/reset-password/:token` renders **without a session**; redeeming sets the new password via
  Better Auth's public `POST /api/auth/reset-password`.
- Redeeming revokes every existing session for that member; the old password is dead immediately.
- A used/expired/unknown token shows *"This reset link is invalid, already used, or expired. Ask
  your admin for a new one."* — reusing a consumed token is a server-side **400**.
- The server is the backstop regardless of the UI: minting below admin tier or cross-tenant is
  **403**, an Admin targeting an Owner is **403**, a non-member target is **404**, and `sso`/OFF
  modes answer **400** (`POST /api/accounts/:accountId/members/:userId/reset-password`).
- The public `POST /api/auth/request-password-reset` endpoint stays anti-enumeration and never
  leaks a token (no email is ever sent; a public call's token goes nowhere).
