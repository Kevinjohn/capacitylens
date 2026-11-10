# US-ACCOUNT-02 — Change my password

As a signed-in person, I want to change my password so that I can keep my account protected with a new credential.

**Status:** Current
**Access:** Any signed-in person.
**Entry:** Account → Change password
**Documentation:** [Account](../../docs-src/using/account.md)
**Source:** [SecuritySection.tsx](../../apps/frontend/src/components/settings/SecuritySection.tsx); [useSecurityController.ts](../../apps/frontend/src/components/settings/useSecurityController.ts); [en.json](../../apps/frontend/messages/en.json)

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
  dialog["SecuritySection renders password dialog"] --> submit["usePasswordChange.submit checks fields"]
  submit --> client["authClient.changePassword sends credentials"]
  client --> route["auth_routes maps change-password to CredentialController.changePassword"]
  route --> kit["Account Kit emailPasswordManagement.changePassword"]
  kit --> sessions["Account Kit changePassword call owns password and other-session effects"]
  sessions --> session["CredentialController invokes sessionGuard.terminate for this session"]
  session --> reload["SecuritySection reloads to sign in with the new password"]
  kit --> error["Rejected credential returns a visible field error"]
```

**Code references:** [AccountView.tsx](../../apps/frontend/src/components/account/AccountView.tsx), [SecuritySection.tsx](../../apps/frontend/src/components/settings/SecuritySection.tsx), [useSecurityController.ts](../../apps/frontend/src/components/settings/useSecurityController.ts), [authClient.ts](../../apps/frontend/src/auth/authClient.ts), [auth_routes.ts](../../apps/backend/start/auth_routes.ts), [credential_controller.ts](../../apps/backend/app/controllers/credential_controller.ts), [DECISIONS.md](../../DECISIONS.md)
