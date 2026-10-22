import { useEffect, useState } from "react";
import { m } from "@/i18n";
import { useAuth } from "@/auth/authContext";
import { useStore } from "@/store/useStore";
import { Modal } from "@/components/common/ui";
import { SelectField } from "@/components/common/fields/SelectField";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useOwnershipTransfer } from "./useOwnershipTransfer";
import type { OwnershipTransferController } from "./useOwnershipTransfer";
import { ActionProofDialog } from "@/auth/ActionProofDialog";

const PENDING_KEY = "capacitylens/ownership-action-proof";

function TransferForm({
  controller,
  selected,
  setSelected,
  onTransfer,
}: {
  controller: OwnershipTransferController;
  selected: string;
  setSelected: (value: string) => void;
  onTransfer: (value: string) => void;
}) {
  const selectedMember = controller.candidates.find((member) => member.userId === selected);
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label={m.ownership_transfer_nominee_label()}
        value={selected}
        onChange={setSelected}
        options={controller.candidates.map((member) => ({
          value: member.userId,
          label: member.name ?? member.email ?? member.userId,
        }))}
        placeholder={m.ownership_transfer_nominee_placeholder()}
        testId="ownership-transfer-nominee"
      />
      {selectedMember && (
        <p className="text-sm text-muted-foreground" data-testid="ownership-transfer-confirmation">
          {m.ownership_transfer_confirmation()}
        </p>
      )}
      <div>
        <Button
          type="button"
          size="sm"
          disabled={controller.busy || selectedMember === undefined}
          data-testid="ownership-transfer-complete"
          onClick={() => onTransfer(selected)}
        >
          {controller.busy ? m.ownership_transfer_working() : m.ownership_transfer_submit()}
        </Button>
      </div>
    </div>
  );
}

function TransferContent({
  controller,
  selected,
  setSelected,
  onTransfer,
}: {
  controller: OwnershipTransferController;
  selected: string;
  setSelected: (value: string) => void;
  onTransfer: (value: string) => void;
}) {
  if (!controller.directoryLoaded && controller.loading) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {m.ownership_transfer_loading()}
      </p>
    );
  }

  const showEmpty = controller.directoryLoaded && controller.candidates.length === 0;
  const showForm = controller.directoryLoaded && controller.candidates.length > 0;
  return (
    <div className="flex flex-col gap-3">
      {controller.error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{controller.error}</AlertDescription>
          {!controller.directoryLoaded && (
            <Button type="button" size="sm" variant="outline" onClick={() => void controller.refresh()}>
              {m.ownership_transfer_retry()}
            </Button>
          )}
        </Alert>
      )}
      {showEmpty && (
        <p className="text-sm text-muted-foreground" data-testid="ownership-transfer-no-candidates">
          {m.ownership_transfer_no_candidates()}
        </p>
      )}
      {showForm && (
        <TransferForm controller={controller} selected={selected} setSelected={setSelected} onTransfer={onTransfer} />
      )}
    </div>
  );
}

/** Shows the Owner a one-step transfer to an active Admin. */
export function OwnershipTransferCard() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [proofTarget, setProofTarget] = useState<string | null>(null);
  const [readyProof, setReadyProof] = useState<{ target: string; id: string } | null>(null);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { refreshAuth } = useAuth();
  const controller = useOwnershipTransfer(activeAccountId, refreshAuth);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("capacitylensActionConfirmed") !== "1") return;
    if (!activeAccountId) return;
    const saved = sessionStorage.getItem(PENDING_KEY);
    if (!saved) return;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem(PENDING_KEY);
      const url = new URL(window.location.href);
      url.searchParams.delete("capacitylensActionConfirmed");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
      try {
        const pending: unknown = JSON.parse(saved);
        if (
          !pending ||
          typeof pending !== "object" ||
          !("accountId" in pending) ||
          pending.accountId !== activeAccountId ||
          !("target" in pending) ||
          typeof pending.target !== "string" ||
          !("proofId" in pending) ||
          typeof pending.proofId !== "string"
        )
          throw new Error("Ownership confirmation could not be resumed.");
        setSelected(pending.target);
        setReadyProof({ target: pending.target, id: pending.proofId });
        setOpen(true);
      } catch {
        useStore.getState().setNotice(m.reauth_failed(), "error");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeAccountId]);
  const requestTransfer = (target: string) => {
    if (readyProof?.target === target) {
      setReadyProof(null);
      void controller.transfer(target, readyProof.id);
    } else setProofTarget(target);
  };
  if (!controller.available) return null;

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
      {open && !proofTarget && (
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
          <TransferContent
            controller={controller}
            selected={selected}
            setSelected={setSelected}
            onTransfer={requestTransfer}
          />
        </Modal>
      )}
      {proofTarget && activeAccountId && (
        <ActionProofDialog
          action="transfer-ownership"
          accountId={activeAccountId}
          intent={{ toUserId: proofTarget }}
          onConfirmed={(id) => {
            const target = proofTarget;
            setProofTarget(null);
            void controller.transfer(target, id);
          }}
          onProviderStart={(id) =>
            sessionStorage.setItem(
              PENDING_KEY,
              JSON.stringify({ accountId: activeAccountId, target: proofTarget, proofId: id }),
            )
          }
          onCancel={() => setProofTarget(null)}
        />
      )}
    </section>
  );
}
