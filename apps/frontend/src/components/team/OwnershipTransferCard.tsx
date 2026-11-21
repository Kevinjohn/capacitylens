import { useState } from 'react';
import { m } from '@/i18n';
import { useAuth } from '@/auth/authContext';
import { useStore } from '@/store/useStore';
import { Modal } from '@/components/common/ui';
import { SelectField } from '@/components/common/fields/SelectField';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useOwnershipTransfer } from './useOwnershipTransfer';
import type { OwnershipTransferViewModel } from './useOwnershipTransfer';
import { PasswordConfirmationDialog } from '@/auth/PasswordConfirmationDialog';

function TransferForm({
  viewModel,
  selected,
  setSelected,
  onTransfer,
}: {
  viewModel: OwnershipTransferViewModel;
  selected: string;
  setSelected: (value: string) => void;
  onTransfer: (value: string) => void;
}) {
  const selectedMember = viewModel.candidates.find((member) => member.userId === selected);
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label={m.ownership_transfer_nominee_label()}
        value={selected}
        onChange={setSelected}
        options={viewModel.candidates.map((member) => ({
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
          disabled={viewModel.busy || selectedMember === undefined}
          data-testid="ownership-transfer-complete"
          onClick={() => onTransfer(selected)}
        >
          {viewModel.busy ? m.ownership_transfer_working() : m.ownership_transfer_submit()}
        </Button>
      </div>
    </div>
  );
}

function TransferContent({
  viewModel,
  selected,
  setSelected,
  onTransfer,
}: {
  viewModel: OwnershipTransferViewModel;
  selected: string;
  setSelected: (value: string) => void;
  onTransfer: (value: string) => void;
}) {
  if (!viewModel.directoryLoaded && viewModel.loading) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {m.ownership_transfer_loading()}
      </p>
    );
  }

  const showEmpty = viewModel.directoryLoaded && viewModel.candidates.length === 0;
  const showForm = viewModel.directoryLoaded && viewModel.candidates.length > 0;
  return (
    <div className="flex flex-col gap-3">
      {viewModel.error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{viewModel.error}</AlertDescription>
          {!viewModel.directoryLoaded && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void viewModel.refresh()}
            >
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
        <TransferForm
          viewModel={viewModel}
          selected={selected}
          setSelected={setSelected}
          onTransfer={onTransfer}
        />
      )}
    </div>
  );
}

/** Shows the Owner a one-step transfer to an active Admin. */
export function OwnershipTransferCard() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [confirmationTarget, setConfirmationTarget] = useState<string | null>(null);
  const activeCompanyId = useStore((state) => state.activeCompanyId);
  const { refreshAuth } = useAuth();
  const viewModel = useOwnershipTransfer(activeCompanyId, refreshAuth);
  const requestTransfer = (target: string) => setConfirmationTarget(target);
  if (!viewModel.available) return null;

  return (
    <section
      data-testid="ownership-transfer-card"
      className="flex flex-wrap items-start justify-between gap-3"
    >
      <div className="flex max-w-2xl flex-col gap-1">
        <h2 className="font-semibold">{m.ownership_transfer_heading()}</h2>
        <p className="text-sm text-muted-foreground">{m.ownership_transfer_intro()}</p>
      </div>
      <Button
        type="button"
        data-testid="ownership-transfer-open"
        onClick={() => {
          setOpen(true);
          void viewModel.refresh();
        }}
      >
        {m.ownership_transfer_open()}
      </Button>
      {open && !confirmationTarget && (
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
            viewModel={viewModel}
            selected={selected}
            setSelected={setSelected}
            onTransfer={requestTransfer}
          />
        </Modal>
      )}
      {confirmationTarget && activeCompanyId && (
        <PasswordConfirmationDialog
          action="transfer-ownership"
          companyId={activeCompanyId}
          intent={{ toUserId: confirmationTarget }}
          onConfirmed={(id) => {
            const target = confirmationTarget;
            setConfirmationTarget(null);
            void viewModel.transfer(target, id);
          }}
          onCancel={() => setConfirmationTarget(null)}
        />
      )}
    </section>
  );
}
