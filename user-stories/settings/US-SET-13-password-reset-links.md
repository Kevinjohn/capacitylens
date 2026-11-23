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
  entry["SignInScreen offers Forgot password? when reset email is available"] --> request["ForgotPassword calls PasswordResetRequestsController.store through authApi"]
  request -->|Accepted| acknowledgement["Show neutral email acknowledgement"]
  request -->|Refused or failed| error["Show delivery-request error"]
  link["Emailed bearer opens ResetPassword form"] -->|Submit valid draft| apply["PasswordResetsController.update asks Account Kit to spend bearer, change password and end all sessions"]
  apply -->|Accepted| done["Show reset complete"]
  apply -->|Ordinary refusal| field["Show link or request error"]
  apply -->|Timeout, server error or no response| check["Ask the person to try the new password before requesting another link"]
```

See [Recover a forgotten password](../account/US-ACCOUNT-03-password-reset.md#code-flow) for the separate inspection API and detailed reset outcomes.

**Code references:** [SignInScreen.tsx](../../apps/frontend/src/auth/SignInScreen.tsx#L83) · [ForgotPassword.tsx](../../apps/frontend/src/auth/ForgotPassword.tsx#L18) · [ResetPassword.tsx](../../apps/frontend/src/auth/ResetPassword.tsx#L164) · [password_reset_requests_controller.ts](../../apps/backend/app/controllers/password_reset_requests_controller.ts#L15) · [password_resets_controller.ts](../../apps/backend/app/controllers/password_resets_controller.ts#L22) · [recovery.spec.ts](../../apps/backend/tests/functional/auth/recovery.spec.ts#L77)
