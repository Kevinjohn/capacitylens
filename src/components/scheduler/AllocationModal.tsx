import { m } from "@/i18n";
import { Modal } from "../common/ui";
import { AllocationFooter } from "./AllocationFooter";
import { AllocationScheduleFields } from "./AllocationScheduleFields";
import { AllocationTargetFields } from "./AllocationTargetFields";
import { useAllocationModalState } from "./useAllocationModalState";

type AllocationModalProps = Parameters<typeof useAllocationModalState>[0];

function buildTitle(editing: boolean, createName: string | undefined) {
  if (editing) return m.form_allocation_edit_title();
  if (createName) {
    return (
      <>
        {m.form_allocation_new_for({ name: "" })}
        <strong>{createName}</strong>
      </>
    );
  }
  return m.form_allocation_new_title();
}

export function AllocationModal(props: AllocationModalProps) {
  const state = useAllocationModalState(props);
  const { editing, createName, onClose, submit, clear } = state.shell;

  return (
    <Modal
      title={buildTitle(editing !== undefined, createName)}
      onClose={onClose}
      onSubmit={submit}
      onEdit={clear}
      footer={<AllocationFooter {...state.footer} />}
    >
      <AllocationTargetFields {...state.targetFields} />
      <AllocationScheduleFields {...state.scheduleFields} />
    </Modal>
  );
}
