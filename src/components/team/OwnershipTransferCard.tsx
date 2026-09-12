import { useState } from "react";
import { m } from "@/i18n";
import type {
  OwnershipTransferState,
  OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import type { OwnershipTransferView, TeamMember } from "../../account/teamAccessClient";
import { useAuth } from "../../auth/authContext";
import { useStore } from "../../store/useStore";
import { SelectField } from "../common/fields/SelectField";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { useOwnershipTransfer, type OwnershipTransferController } from "./useOwnershipTransfer";

/**
 * The three-step ownership transfer ceremony, for whichever side of it the viewer is on.
 *
 * The card renders NOTHING for anyone who is not a participant. That is not tidiness: a transfer in
 * progress, and who it names, is not ordinary member-management information, and the server returns
 * an empty projection to everyone else — so there is nothing to render even if this decided
 * otherwise. Every control's authority is re-checked by the server; hiding is never the mechanism.
 */

function memberLabel(members: readonly TeamMember[], userId: string): string {
  const member = members.find((candidate) => candidate.userId === userId);
  return member?.name ?? member?.email ?? userId;
}

/** One sentence for one terminal reason. Shared by the historic outcome and by the outcome a
 *  command just committed, so the two can never explain the same reason differently. */
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

/** The two things the card says about the last action: what it committed, and what went wrong.
 *  Both are answers to the command the viewer just gave, so they live together. */
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

/** The Owner's half: choose an Admin and propose. Only active Admins are offered — the ceremony
 *  hands the company to someone who already administers it, so a lower tier would be an elevation
 *  of two steps on one person's say-so, and the server refuses it regardless. */
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

/** Who may be nominated: the company's active Admins, never the person a live request already
 *  names. Offering the current nominee again would ask the server to replace a request with itself. */
function adminCandidates(members: readonly TeamMember[], excludeUserId?: string): readonly TeamMember[] {
  return members.filter(
    (member) => member.role === "admin" && member.status === "active" && member.userId !== excludeUserId,
  );
}

interface ControlsProps {
  controller: OwnershipTransferController;
  request: OwnershipTransferView;
  /** The nominee has accepted, so the ceremony is waiting on the Owner's second act. */
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

/** One ceremony step as a button. Every step sends the same command against the same request at the
 *  revision the card read, so the only things that vary are which step, how it reads and whether it
 *  is the primary action of the pair. */
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
  // Consent already given: the only thing left to offer is taking it back, which returns the
  // nomination to the Owner rather than ending it.
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
        {m.ownership_transfer_deadline({ deadline: new Date(request.expiresAt).toLocaleString() })}
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

/** What the card shows once it has something to say: the live ceremony, or the nomination control,
 *  or the explanation of how the last one ended. */
function CeremonyBody({ controller, principalId, mayNominate }: CeremonyBodyProps) {
  const live = controller.projection?.live ?? null;
  const outcome = controller.projection?.latestOutcome ?? null;
  if (live !== null) {
    return <LiveRequest controller={controller} request={live} isInitiator={live.fromUserId === principalId} />;
  }
  return (
    <>
      {/* Shown ALONGSIDE the nominate control, never instead of it. The Owner is the one person who
          can always start a transfer, so an either/or would hand them a fresh panel and no word of
          the decline, expiry or invalidation that ended the last one while they were away. */}
      <LastOutcome outcome={outcome} />
      {mayNominate && (
        <NominatePanel controller={controller} candidates={adminCandidates(controller.members)} replacing={false} />
      )}
    </>
  );
}

/** How the last ceremony this viewer took part in ended, dated. The row is retained for a year, so
 *  an undated sentence would read as news every time the team page is opened. */
function LastOutcome({ outcome }: { outcome: OwnershipTransferView | null }) {
  if (outcome === null) return null;
  const said = describeReason(outcome.terminalReason, outcome.state);
  if (said === "") return null;
  return (
    <p className="text-sm text-muted-foreground" data-testid="ownership-transfer-outcome">
      {outcome.terminalAt === null
        ? said
        : m.ownership_transfer_outcome_on({ outcome: said, date: new Date(outcome.terminalAt).toLocaleDateString() })}
    </p>
  );
}

/** Only the current Owner may propose, and only when nothing is already live. The server enforces
 *  this; hiding the control merely keeps the card honest about what it offers. */
function mayNominate(controller: OwnershipTransferController, principalId: string | null): boolean {
  if (controller.projection?.live) return false;
  return controller.members.some((member) => member.userId === principalId && member.role === "owner");
}

/**
 * Has this card anything to tell this viewer?
 *
 * Nothing live, nothing to explain and no standing to start one: render nothing rather than an
 * empty card that invites a question it cannot answer. A failure IS something to say, so it keeps
 * the card open — a nominee whose read failed must not be shown the same blank page as a nominee
 * who has no request at all.
 */
function hasSomethingToSay(controller: OwnershipTransferController, nominatable: boolean): boolean {
  if (controller.loading) return false;
  if (nominatable || controller.error !== null || controller.lastTerminal !== null) return true;
  return Boolean(controller.projection?.live ?? controller.projection?.latestOutcome);
}

export function OwnershipTransferCard() {
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { user, refreshAuth } = useAuth();
  const controller = useOwnershipTransfer(activeAccountId, refreshAuth);
  const principalId = user?.id ?? null;
  const nominatable = mayNominate(controller, principalId);
  if (!hasSomethingToSay(controller, nominatable)) return null;

  return (
    <Card data-testid="ownership-transfer-card">
      <CardHeader>
        <CardTitle>
          <h2>{m.ownership_transfer_heading()}</h2>
        </CardTitle>
        <CardDescription>{m.ownership_transfer_intro()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CeremonyBody controller={controller} principalId={principalId} mayNominate={nominatable} />
        <CeremonyAlerts controller={controller} />
      </CardContent>
    </Card>
  );
}
