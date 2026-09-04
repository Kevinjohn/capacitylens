import { m } from "@/i18n";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../common/dialogs";
import { RepeatedAllocationDeleteDialog } from "./RepeatedAllocationDeleteDialog";
import { undoShortcut } from "../../lib/keyboardShortcuts";
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
  return (
    <>
      {confirmDelete && editing?.seriesId ? (
        <RepeatedAllocationDeleteDialog
          onDeleteOne={() => onDelete("one")}
          onDeleteFuture={() => onDelete("future")}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : confirmDelete ? (
        <ConfirmDialog
          title={m.form_allocation_delete_title()}
          message={m.form_allocation_delete_message({ shortcut: undoShortcut() })}
          onConfirm={() => onDelete("one")}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
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
