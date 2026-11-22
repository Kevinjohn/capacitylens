import { m } from '@/i18n';
import { FormDialog } from '@/components/common/ui';
import { AllocationFooter } from './AllocationFooter';
import { AllocationScheduleFields } from './AllocationScheduleFields';
import { AllocationTargetFields } from './AllocationTargetFields';
import { useAllocationDialogState } from './useAllocationDialogState';
import type { AllocationDialogProps } from './allocationDialogTypes';

type BuildTitleOptions = { editing: boolean; createName: string | undefined };
function buildTitle({ editing, createName }: BuildTitleOptions) {
  if (editing) return m.form_allocation_edit_title();
  if (createName) {
    return (
      <>
        {m.form_allocation_new_for({ name: '' })}
        <strong>{createName}</strong>
      </>
    );
  }
  return m.form_allocation_new_title();
}

/** Coordinates allocation creation or editing in a guarded dialog. */
export function AllocationDialog(props: AllocationDialogProps) {
  const state = useAllocationDialogState(props);
  const { editing, createName, onClose, submit, clear } = state.shell;

  return (
    <FormDialog
      title={buildTitle({ editing: editing !== undefined, createName })}
      onClose={onClose}
      onSubmit={submit}
      onEdit={clear}
      footer={<AllocationFooter {...state.footer} />}
    >
      <AllocationTargetFields {...state.targetFields} />
      <AllocationScheduleFields {...state.scheduleFields} />
    </FormDialog>
  );
}
