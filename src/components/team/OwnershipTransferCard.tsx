import { useState } from "react";
import { m } from "@/i18n";
import type {
  OwnershipTransferState,
  OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import type { OwnershipTransferView, TeamMember } from "@/account/teamAccessClient";
import { useAuth } from "@/auth/authContext";
import { useStore } from "@/store/useStore";
import { formatInstant, formatInstantDate } from "@/lib/dateDisplay";
import { Modal } from "@/components/common/ui";
import { SelectField } from "@/components/common/fields/SelectField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useOwnershipTransfer } from "./useOwnershipTransfer";
import type { OwnershipTransferController } from "./useOwnershipTransfer";

// Ownership-transfer details are participant-scoped and remain server-authorized; the Owner entry point also allows starting a new ceremony.

function memberLabel(members: readonly TeamMember[], userId: string): string {
  const member = members.find((candidate) => candidate.userId === userId);
  return member?.name ?? member?.email ?? userId;
}

// Both displayed transfer outcomes share the reason mapper so they explain identical terminal reasons consistently.
function describeReason(reason: OwnershipTransferTerminalReason | null, state: OwnershipTransferState): string {
  switch (reason) {
    case "target_declined":
      return m.ownership_transfer_outcome_declined();
    case "owner_cancelled":
      return m.ownership_transfer_outcome_cancelled();
    case "replaced":
      return m.ownership_transfer_outcome_replaced();
    case "deadline_passed":
      return m.ownership_transfer_outcome_expired();
    case "account_erased":
    case "owner_repaired":
    case "initiator_not_owner":
    case "target_not_admin":
    case "participant_membership_changed":
      return m.ownership_transfer_outcome_invalidated();
    case null:
      return state === "completed" ? m.ownership_transfer_outcome_completed() : "";
  }
}

function CeremonyAlerts({ controller }: { controller: OwnershipTransferController }) {
  const terminal = controller.lastTerminal;
  return (
    <>
      {terminal !== null && (
        <Alert>
          <AlertDescription>{describeReason(terminal.reason, terminal.state)}</AlertDescription>
        </Alert>
      )}
      {controller.error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{controller.error}</AlertDescription>
          <Button type="button" size="sm" variant="outline" onClick={() => void controller.refresh()}>
            {m.ownership_transfer_retry()}
          </Button>
        </Alert>
      )}
    </>
  );
}

interface NominatePanelProps {
  controller: OwnershipTransferController;
  candidates: readonly TeamMember[];
  replacing: boolean;
}

// Nominees must already be active Admins so transferring ownership does not also grant an unrelated administrative elevation.
function NominatePanel({ controller, candidates, replacing }: NominatePanelProps) {
  const [selected, setSelected] = useState("");
  if (candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">{m.ownership_transfer_no_candidates()}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label={m.ownership_transfer_nominee_label()}
        value={selected}
        onChange={setSelected}
        options={candidates.map((member) => ({
          value: member.userId,
          label: member.name ?? member.email ?? member.userId,
        }))}
        placeholder={m.ownership_transfer_nominee_placeholder()}
        testId="ownership-transfer-nominee"
      />
      <div>
        <Button
          type="button"
          size="sm"
          disabled={controller.busy || selected === ""}
          data-testid={replacing ? "ownership-transfer-replace" : "ownership-transfer-start"}
          onClick={() => void controller.nominate(selected)}
        >
          {replacing ? m.ownership_transfer_replace() : m.ownership_transfer_start()}
        </Button>
      </div>
    </div>
  );
}

// Exclude the standing nominee so replacement cannot propose the same person again.
function adminCandidates(members: readonly TeamMember[], excludeUserId?: string): readonly TeamMember[] {
  return members.filter(
    (member) => member.role === "admin" && member.status === "active" && member.userId !== excludeUserId,
  );
}

interface ControlsProps {
  controller: OwnershipTransferController;
  request: OwnershipTransferView;

  awaitingOwner: boolean;
}

interface LiveRequestProps {
  controller: OwnershipTransferController;
  request: OwnershipTransferView;
  isInitiator: boolean;
}

type CeremonyStep = "complete" | "cancel" | "accept" | "decline" | "withdraw";

interface StepButtonProps {
  controller: OwnershipTransferController;
  request: OwnershipTransferView;
  step: CeremonyStep;
  label: string;
  variant?: "outline";
}

// Each step targets its request at the revision the dialog observed, so stale controls cannot overwrite a newer ceremony.
function StepButton({ controller, request, step, label, variant }: StepButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={controller.busy}
      data-testid={`ownership-transfer-${step}`}
      onClick={() => void controller.command({ requestId: request.id, step, expectedRevision: request.revision })}
    >
      {label}
    </Button>
  );
}

function OwnerControls({ controller, request, awaitingOwner }: ControlsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {awaitingOwner && (
        <StepButton controller={controller} request={request} step="complete" label={m.ownership_transfer_complete()} />
      )}
      <StepButton
        controller={controller}
        request={request}
        step="cancel"
        variant="outline"
        label={m.ownership_transfer_cancel()}
      />
    </div>
  );
}

function NomineeControls({ controller, request, awaitingOwner }: ControlsProps) {
  if (awaitingOwner) {
    return (
      <StepButton
        controller={controller}
        request={request}
        step="withdraw"
        variant="outline"
        label={m.ownership_transfer_withdraw()}
      />
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <StepButton controller={controller} request={request} step="accept" label={m.ownership_transfer_accept()} />
      <StepButton
        controller={controller}
        request={request}
        step="decline"
        variant="outline"
        label={m.ownership_transfer_decline()}
      />
    </div>
  );
}

function LiveRequest({ controller, request, isInitiator }: LiveRequestProps) {
  const awaitingOwner = request.state === "awaiting_owner";
  const nominee = memberLabel(controller.members, request.toUserId);
  const proposer = memberLabel(controller.members, request.fromUserId);
  const status = (() => {
    if (isInitiator) {
      return awaitingOwner
        ? m.ownership_transfer_state_accepted({ nominee })
        : m.ownership_transfer_state_waiting({ nominee });
    }
    return awaitingOwner
      ? m.ownership_transfer_state_awaiting_owner({ proposer })
      : m.ownership_transfer_state_invited({ proposer });
  })();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink" data-testid="ownership-transfer-state">
        {status}
      </p>
      <p className="text-sm text-muted-foreground">
        {m.ownership_transfer_deadline({ deadline: formatInstant(request.expiresAt) })}
      </p>
      {isInitiator ? (
        <OwnerControls controller={controller} request={request} awaitingOwner={awaitingOwner} />
      ) : (
        <NomineeControls controller={controller} request={request} awaitingOwner={awaitingOwner} />
      )}
      {isInitiator && !awaitingOwner && (
        <NominatePanel
          controller={controller}
          candidates={adminCandidates(controller.members, request.toUserId)}
          replacing
        />
      )}
    </div>
  );
}

interface CeremonyBodyProps {
  controller: OwnershipTransferController;
  principalId: string | null;
  mayNominate: boolean;
}

function CeremonyBody({ controller, principalId, mayNominate }: CeremonyBodyProps) {
  const live = controller.projection?.live ?? null;
  const outcome = controller.projection?.latestOutcome ?? null;
  if (live !== null) {
    return <LiveRequest controller={controller} request={live} isInitiator={live.fromUserId === principalId} />;
  }
  return (
    <>
      {/* Keep the previous terminal outcome visible beside the Owner's new nomination controls so starting another request does not hide what ended the last one. */}
      <LastOutcome outcome={outcome} />
      {mayNominate && (
        <NominatePanel controller={controller} candidates={adminCandidates(controller.members)} replacing={false} />
      )}
    </>
  );
}

// Date retained terminal outcomes so reopening the page does not present old events as new.
function LastOutcome({ outcome }: { outcome: OwnershipTransferView | null }) {
  if (outcome === null) return null;
  const said = describeReason(outcome.terminalReason, outcome.state);
  if (said === "") return null;
  return (
    <p className="text-sm text-muted-foreground" data-testid="ownership-transfer-outcome">
      {outcome.terminalAt === null
        ? said
        : m.ownership_transfer_outcome_on({ outcome: said, date: formatInstantDate(outcome.terminalAt) })}
    </p>
  );
}

function mayNominate(controller: OwnershipTransferController, principalId: string | null): boolean {
  if (controller.projection?.live) return false;
  return controller.members.some((member) => member.userId === principalId && member.role === "owner");
}

// A failed read must keep the entry point visible; absence of known transfer state is not proof that no action or outcome exists.
type HasSomethingToSayOptions = { controller: OwnershipTransferController; nominatable: boolean };
function hasSomethingToSay({ controller, nominatable }: HasSomethingToSayOptions): boolean {
  if (controller.loading) return false;
  if (nominatable || controller.error !== null || controller.lastTerminal !== null) return true;
  return Boolean(controller.projection?.live ?? controller.projection?.latestOutcome);
}

/** Shows current ownership and guarded transfer controls. */
export function OwnershipTransferCard() {
  const [open, setOpen] = useState(false);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { user, refreshAuth } = useAuth();
  const controller = useOwnershipTransfer(activeAccountId, refreshAuth);
  const principalId = user?.id ?? null;
  const nominatable = mayNominate(controller, principalId);
  if (!hasSomethingToSay({ controller: controller, nominatable: nominatable })) return null;

  return (
    <section data-testid="ownership-transfer-card" className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex max-w-2xl flex-col gap-1">
        <h2 className="font-semibold">{m.ownership_transfer_heading()}</h2>
        <p className="text-sm text-muted-foreground">{m.ownership_transfer_intro()}</p>
      </div>
      <Button
        type="button"
        data-testid="ownership-transfer-open"
        onClick={() => {
          setOpen(true);
          void controller.refresh();
        }}
      >
        {m.ownership_transfer_open()}
      </Button>
      {open && (
        <Modal
          title={m.ownership_transfer_heading()}
          description={m.ownership_transfer_intro()}
          guardDirty={false}
          onClose={() => setOpen(false)}
          footer={
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              {m.ownership_transfer_close()}
            </Button>
          }
        >
          <CeremonyBody controller={controller} principalId={principalId} mayNominate={nominatable} />
          <CeremonyAlerts controller={controller} />
        </Modal>
      )}
    </section>
  );
}
