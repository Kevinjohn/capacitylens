import { m } from "@/i18n";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../common/dialogs";
import { RepeatedAllocationDeleteDialog } from "./RepeatedAllocationDeleteDialog";
import { buildUndoShortcut } from "../../lib/keyboardShortcuts";
import type { AllocationModalState } from "./useAllocationModalState";

type AllocationFooterProps = AllocationModalState["footer"];

export function AllocationFooter({
  editing,
  canEdit,
  confirmDelete,
  setConfirmDelete,
  onDelete,
  onDuplicate,
  onClose,
}: AllocationFooterProps) {
  let deleteDialog = null;
  if (confirmDelete && editing?.seriesId) {
    deleteDialog = (
      <RepeatedAllocationDeleteDialog
        onDeleteOne={() => onDelete("one")}
        onDeleteFuture={() => onDelete("future")}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  } else if (confirmDelete) {
    deleteDialog = (
      <ConfirmDialog
        title={m.form_allocation_delete_title()}
        message={m.form_allocation_delete_message({ shortcut: buildUndoShortcut() })}
        onConfirm={() => onDelete("one")}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  }
  return (
    <>
      {deleteDialog}
      {editing && canEdit && (
        <>
          <Button size="sm" type="button" variant="danger-soft" onClick={() => setConfirmDelete(true)}>
            {m.form_delete()}
          </Button>
          {!editing.seriesId && (
            <Button size="sm" type="button" variant="outline" onClick={onDuplicate}>
              {m.form_allocation_duplicate()}
            </Button>
          )}
        </>
      )}
      <span className="flex-1" />
      <Button size="sm" type="button" variant="outline" onClick={onClose}>
        {m.form_cancel()}
      </Button>
      {canEdit && (
        <Button size="sm" type="submit">
          {m.form_save()}
        </Button>
      )}
    </>
  );
}
