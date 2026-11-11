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
