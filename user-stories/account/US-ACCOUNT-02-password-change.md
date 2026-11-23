# US-ACCOUNT-02 — Change my password

As a signed-in person, I want to change my password so that I can keep my account protected with a new credential.

**Status:** Current
**Access:** Any signed-in person.
**Entry:** Account → Change password
**Documentation:** [Account](../../docs-src/using/account.md)
**Source:** [SecuritySection.tsx](../../apps/frontend/src/components/settings/SecuritySection.tsx); [useSecurityViewModel.ts](../../apps/frontend/src/components/settings/useSecurityViewModel.ts); [en.json](../../apps/frontend/messages/en.json)

## Acceptance criteria

| Field                | Control        | Required/default/conditions        |
| -------------------- | -------------- | ---------------------------------- |
| Current password     | Password input | Required.                          |
| New password         | Password input | Required; 15–128 characters.       |
| Confirm new password | Password input | Required; must match New password. |

- **Change password** submits the form; **Cancel** closes it and clears its fields. On success, the fields clear and the person signs in again with the new password. Validation or rejected changes leave the password unchanged.

## User flow

```mermaid
flowchart TD
  open["Account → Change password"] --> fields["Enter current password and matching new password"]
  fields --> submit["Change password"]
  submit --> success["Success: sign in again with the new password"]
  submit --> error["Error: correct the form and retry"]
  fields --> cancel["Cancel: close the dialog and clear its fields"]
```

## Code flow

```mermaid
flowchart TD
  form["AccountView opens SecuritySection PasswordDialog"] -->|Cancel| clear["Reset draft; an already dispatched request continues"]
  form -->|Submit| validate["usePasswordChange validates the draft"]
  validate -->|Invalid| error["Current dialog shows the field error"]
  validate -->|Valid| request["authApi.changePassword"]
  request --> guard["Auth route refuses own-account writes in View as member"]
  guard -->|Allowed| current["PasswordController.update validates the request and verifies the account through readCurrentAccount(auth)"]
  current -->|Verified| kit["Account Kit checks the current password, sets the new password and revokes all registered sign-ins"]
  current -->|Refused| error
  guard -->|Refused| error
  kit -->|Wrong current password or other refusal| error
  kit -->|Changed or committed with a follow-up warning| terminate["PasswordController terminates the browser session through the raw web guard"]
  terminate --> response["Ordinary success or CREDENTIAL_UPDATE_COMMITTED"]
  response --> reload["Navigate to the root to sign in with the new password"]
  request -->|No response| unknown["Current dialog asks the person to check which password works"]
```

See [Signed-in requests](../REFERENCE.md#signed-in-requests) for the raw guard and account check.

**Code references:** [AccountView.tsx](../../apps/frontend/src/components/account/AccountView.tsx#L88) · [SecuritySection.tsx](../../apps/frontend/src/components/settings/SecuritySection.tsx#L75) · [useSecurityViewModel.ts](../../apps/frontend/src/components/settings/useSecurityViewModel.ts#L36) · [password_controller.ts](../../apps/backend/app/controllers/password_controller.ts#L14) · [route_middleware.ts](../../apps/backend/start/route_middleware.ts#L50) · [password_sessions.spec.ts](../../apps/backend/tests/functional/auth/password_sessions.spec.ts#L153)
