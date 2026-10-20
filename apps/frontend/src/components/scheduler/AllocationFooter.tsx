import { m } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/dialogs";
import { RepeatedAllocationDeleteDialog } from "./RepeatedAllocationDeleteDialog";
import { buildUndoShortcut } from "@/lib/keyboardShortcuts";
import type { AllocationModalState } from "./useAllocationModalState";

type AllocationFooterProps = AllocationModalState["footer"];

/** Shows allocation form actions and validation status. */
export function AllocationFooter({
  editing,
  canEdit,
  confirmDelete,
  setConfirmDelete,
  onDelete,
  onDuplicate,
  onClose,
  busy,
}: AllocationFooterProps) {
  // The delete and duplicate commands catch and surface their own failures.
  let deleteDialog = null;
  if (confirmDelete && editing?.seriesId) {
    deleteDialog = (
      <RepeatedAllocationDeleteDialog
        busy={busy}
        onDeleteOne={() => {
          void onDelete("one");
        }}
        onDeleteFuture={() => {
          void onDelete("future");
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    );
  } else if (confirmDelete) {
    deleteDialog = (
      <ConfirmDialog
        title={m.form_allocation_delete_title()}
        message={m.form_allocation_delete_message({ shortcut: buildUndoShortcut() })}
        onConfirm={() => {
          void onDelete("one");
        }}
        onCancel={() => setConfirmDelete(false)}
        busy={busy}
      />
    );
  }
  return (
    <>
      {deleteDialog}
      {editing && canEdit && (
        <>
          <Button size="sm" type="button" variant="danger-soft" disabled={busy} onClick={() => setConfirmDelete(true)}>
            {m.form_delete()}
          </Button>
          {!editing.seriesId && (
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                void onDuplicate();
              }}
            >
              {m.form_allocation_duplicate()}
            </Button>
          )}
        </>
      )}
      <span className="flex-1" />
      <Button size="sm" type="button" variant="outline" disabled={busy} onClick={onClose}>
        {m.form_cancel()}
      </Button>
      {canEdit && (
        <Button size="sm" type="submit" disabled={busy}>
          {m.form_save()}
        </Button>
      )}
    </>
  );
}
