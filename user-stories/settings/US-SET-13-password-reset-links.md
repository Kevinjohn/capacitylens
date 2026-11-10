# US-SET-13 — Recover a password

As a person with an account, I want to reset a forgotten password so that I can regain sign-in access.

**Status:** Current — detailed account story is US-ACCOUNT-03.
**Access:** Any person with an account
**Entry:** Sign in → Forgot password?
**Documentation:** [Account](../../docs-src/using/account.md)
**Source:** [ForgotPassword.tsx](../../apps/frontend/src/auth/ForgotPassword.tsx), [ResetPassword.tsx](../../apps/frontend/src/auth/ResetPassword.tsx)

## Acceptance criteria

- Use the recovery email and new-password fields in [Recover a password](../account/US-ACCOUNT-03-password-reset.md).

## User flow

```mermaid
flowchart TD
A["Open password recovery at sign-in"] --> B["Enter email and request a reset link"]
B --> C["Open the emailed link"] --> D["Enter and confirm a new password"]
D --> E{"Reset accepted?"}
E -->|yes| F["Sign in with the new password"]
E -->|no| G["Read the error; request a new link if it expired"]
```

## Code flow

```mermaid
flowchart TD
  forgot["ForgotPassword submits email to authClient"] --> request["authClient.requestPasswordReset calls auth endpoint"]
  request --> email["auth_controller issues reset email without disclosing account existence"]
  link["ResetPassword reads bearer from route"] --> submit["authClient.resetPassword submits new password"]
  submit --> session["Account Kit credential change ends sessions"]
```

**Code references:** [ForgotPassword.tsx](../../apps/frontend/src/auth/ForgotPassword.tsx), [ResetPassword.tsx](../../apps/frontend/src/auth/ResetPassword.tsx), [authClient.ts](../../apps/frontend/src/auth/authClient.ts), [auth_controller.ts](../../apps/backend/app/controllers/auth_controller.ts)
