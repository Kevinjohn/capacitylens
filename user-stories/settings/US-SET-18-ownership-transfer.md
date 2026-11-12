# US-SET-18 — Transfer company ownership

As an Owner, I want to transfer company ownership so that another active Admin can take responsibility.

**Status:** Current
**Access:** Owner
**Entry:** Team & access → Company ownership
**Documentation:** [Transfer ownership](../../docs-src/owner/responsibilities.md#transfer-ownership)
**Source:** [OwnershipTransferCard.tsx](../../apps/frontend/src/components/team/OwnershipTransferCard.tsx), [PasswordConfirmationDialog.tsx](../../apps/frontend/src/auth/PasswordConfirmationDialog.tsx)

## Acceptance criteria

| Field      | Control        | Required/default/conditions                                                  |
| ---------- | -------------- | ---------------------------------------------------------------------------- |
| Next Owner | Member picker  | Required to transfer; another active Admin in this company.                  |
| Password   | Password input | Required in the following confirmation dialog; the current Owner's password. |

- **Transfer ownership** opens password confirmation; **Continue** completes it. **Close** or **Cancel** leaves ownership unchanged. The selected Admin becomes Owner and the former Owner becomes Admin.

## User flow

```mermaid
flowchart TD
A["Open Team & access: Manage ownership"] --> B["Choose another active Admin as Next Owner"]
B --> C{"Transfer ownership or Close?"}
C -->|close| D["Ownership remains unchanged"]
C -->|transfer| E["Enter the current password"]
E -->|cancel| D
E -->|continue| F{"Confirmation and transfer accepted?"}
F -->|yes| G["Selected Admin becomes Owner; former Owner becomes Admin"]
F -->|no| H["Read the error and review current access"]
```

## Code flow

```mermaid
flowchart TD
  card["OwnershipTransferCard selects active Admin candidate"] --> dialog["PasswordConfirmationDialog issues transfer-ownership confirmation"]
  dialog --> hook["useOwnershipTransfer calls teamAccessClient.transferOwnership"]
  hook --> route["ownership route dispatches OwnershipController.transfer"]
  route --> service["transferOwnership checks Owner, active Admin and confirmation"]
  service --> transaction["runAccountCommand withActor transaction transfers membership, revision and audit"]
  transaction --> result["settleTransfer refreshes auth and reprojects access"]
```

**Code references:** [OwnershipTransferCard.tsx](../../apps/frontend/src/components/team/OwnershipTransferCard.tsx), [useOwnershipTransfer.ts](../../apps/frontend/src/components/team/useOwnershipTransfer.ts), [teamAccessClient.ts](../../apps/frontend/src/account/teamAccessClient.ts), [PasswordConfirmationDialog.tsx](../../apps/frontend/src/auth/PasswordConfirmationDialog.tsx), [ownership_routes.ts](../../apps/backend/start/ownership_routes.ts), [ownership_controller.ts](../../apps/backend/app/controllers/ownership_controller.ts), [ownership_transfer.ts](../../apps/backend/app/services/membership/ownership_transfer.ts), [account_commands.ts](../../apps/backend/app/services/account_commands.ts)
