import { m } from "@/i18n";
import { Modal } from "@/components/common/ui";
import { PlanningStatusBanner } from "@/components/PlanningStatusBanner";
import { AllocationFooter } from "./AllocationFooter";
import { AllocationScheduleFields } from "./AllocationScheduleFields";
import { AllocationTargetFields } from "./AllocationTargetFields";
import { useAllocationModalState } from "./useAllocationModalState";

type AllocationModalProps = Parameters<typeof useAllocationModalState>[0];

type BuildTitleOptions = { editing: boolean; createName: string | undefined };
function buildTitle({ editing, createName }: BuildTitleOptions) {
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

/** Coordinates allocation creation or editing in a guarded dialog. */
export function AllocationModal(props: AllocationModalProps) {
  const state = useAllocationModalState(props);
  const { editing, createName, onClose, submit, clear } = state.shell;

  // submit catches save failures and keeps the dialog editable.
  return (
    <Modal
      title={buildTitle({ editing: editing !== undefined, createName: createName })}
      onClose={onClose}
      busy={state.busy}
      recovery={<PlanningStatusBanner placement="modal" />}
      onSubmit={() => {
        void submit();
      }}
      onEdit={clear}
      footer={<AllocationFooter {...state.footer} />}
    >
      <AllocationTargetFields {...state.targetFields} />
      <AllocationScheduleFields {...state.scheduleFields} />
    </Modal>
  );
}
