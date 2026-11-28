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
  card["Manage ownership in OwnershipTransferCard reads the Owner directory"] -->|Read failure| retry["Show Try again"]
  retry --> card
  card -->|Close| closed["Dismiss chooser without sending a transfer"]
  card -->|No active Admin| empty["Show no eligible successor"]
  card -->|Choose another active Admin| dialog["PasswordConfirmationDialog requests transfer-ownership proof bound to toUserId"]
  dialog -->|Cancel| card
  dialog -->|Proof refused| inlineError["Show proof error"]
  dialog -->|Confirmed| request["useOwnershipTransfer submits the target and proof"]
  request --> guard["OwnershipTransfersController uses withActor(auth); transferOwnership calls runAccountOperation"]
  guard -->|Repeat carrying the same operation key; the browser sends none| receipt["Return stored receipt without spending proof again"]
  guard -->|New operation| checks["Check live Owner, eligible active Admin and one-Owner invariant before consuming proof"]
  checks -->|Refused| refusal["Show transfer refusal"]
  guard -->|Access or operation refused| refusal
  checks -->|Proof consumed| swap["Commit role swap, revision, audit and operation receipt"]
  swap --> reconcile["settleTransfer refreshes auth and reprojects caller access"]
  receipt --> reconcile
  request -->|Unknown result| reconcile
  reconcile -->|Failed| reload["Close the company and ask the person to reopen it"]
```

See [password proof issuance](../data/US-DAT-08-preview-exact-import.md#code-flow) for the shared authorization callback. Ownership transfer binds the proof to the selected successor.

**Code references:** [OwnershipTransferCard.tsx](../../apps/frontend/src/components/team/OwnershipTransferCard.tsx#L69) · [OwnershipTransferCard.tsx](../../apps/frontend/src/components/team/OwnershipTransferCard.tsx#L114) · [useOwnershipTransfer.ts](../../apps/frontend/src/components/team/useOwnershipTransfer.ts#L32) · [useOwnershipTransfer.ts](../../apps/frontend/src/components/team/useOwnershipTransfer.ts#L115) · [ownership_transfers_controller.ts](../../apps/backend/app/controllers/ownership_transfers_controller.ts#L25) · [ownership_transfer_service.ts](../../apps/backend/app/services/membership/ownership_transfer_service.ts#L54) · [account_operation_service.ts](../../apps/backend/app/services/account_operation_service.ts#L33) · [ownership_transfer.spec.ts](../../apps/backend/tests/functional/membership/ownership_transfer.spec.ts#L127)
