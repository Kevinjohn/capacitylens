# US-ACCOUNT-05 — Delete my account

As a signed-in person, I want to delete my account so that my sign-in and company memberships are removed.

**Status:** Current
**Access:** Any signed-in person; an Owner must transfer ownership first.
**Entry:** Account → Delete account
**Documentation:** [Account](../../docs-src/using/account.md)
**Source:** [AccountView.tsx](../../apps/frontend/src/components/account/AccountView.tsx); [SecuritySection.tsx](../../apps/frontend/src/components/settings/SecuritySection.tsx); [useSecurityViewModel.ts](../../apps/frontend/src/components/settings/useSecurityViewModel.ts)

## Acceptance criteria

| Field            | Control        | Required/default/conditions                                         |
| ---------------- | -------------- | ------------------------------------------------------------------- |
| Current password | Password input | Required. Confirms this one deletion through password confirmation. |

- The dialog explains that deletion cannot be undone and removes the sign-in and company memberships; the person Resource remains on past schedules, while audit history retains the former user ID.
- **Delete account** submits the form; **Cancel** closes the dialog and clears its field. An Owner must transfer ownership before deletion. On success, the browser returns to sign-in.
- The password is checked through a single-use `delete-account` password confirmation, with the same wrong-password limit as ownership transfer, import and company anonymisation. A wrong password shows **Incorrect password.** against the field and deletes nothing.

## User flow

```mermaid
flowchart TD
  open["Account → Delete account"] --> password["Enter current password"]
  password --> submit["Delete account"]
  submit --> denied["Wrong password: Incorrect password. shown on the field"]
  submit --> success["Success: account is removed; return to sign in"]
  submit --> owner["Owner conflict: transfer ownership first"]
  password --> cancel["Cancel: close the dialog and clear the field"]
```

## Code flow

```mermaid
flowchart TD
  dialog["AccountView opens SecuritySection DeleteAccountDialog"] -->|Cancel| clear["Clear the draft; a dispatched request continues"]
  dialog -->|Submit| api["useAccountDeletion validates and calls authApi.deleteAccount"]
  api --> guard["Auth route refuses own-account writes in View as member"]
  guard -->|Allowed| proof["AccountController.destroy issues and spends delete-account proof for this user outside the Kit deletion transaction"]
  proof -->|Password or throttle refusal| field["Show the current-password error"]
  proof -->|Spent| kit["Account Kit rechecks password and starts the deletion transaction"]
  kit -->|Owner| owner["LAST_OWNER: show transfer-ownership requirement"]
  kit -->|Wrong current password| field
  kit -->|Eligible| cleanup["Delete identity and memberships/links; record revision and audit; retain resources, history and invitations with inviter cleared"]
  cleanup --> terminate["Terminate current managed sign-in"]
  terminate -->|Success or ACCOUNT_DELETION_COMMITTED| reload["Navigate to the root"]
  api -->|No response| unknown["Show outcome unknown if the dialog is still current"]
  guard -->|Refused| field
```

**Code references:** [AccountView.tsx](../../apps/frontend/src/components/account/AccountView.tsx#L88) · [SecuritySection.tsx](../../apps/frontend/src/components/settings/SecuritySection.tsx#L112) · [useSecurityViewModel.ts](../../apps/frontend/src/components/settings/useSecurityViewModel.ts#L112) · [account_controller.ts](../../apps/backend/app/controllers/account_controller.ts#L29) · [route_middleware.ts](../../apps/backend/start/route_middleware.ts#L50) · [account_kit.ts](../../apps/backend/config/account_kit.ts#L49) · [membership_effects.ts](../../apps/backend/app/services/account_kit/membership_effects.ts#L31) · [account_deletion.spec.ts](../../apps/backend/tests/functional/auth/account_deletion.spec.ts#L85)
