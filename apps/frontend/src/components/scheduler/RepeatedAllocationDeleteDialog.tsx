import { useRef } from "react";
import { m } from "@/i18n";
import { buildUndoShortcut } from "@/lib/keyboardShortcuts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Requires a choice between deleting one entry and its repeated group. */
export function RepeatedAllocationDeleteDialog({
  busy = false,
  onDeleteOne,
  onDeleteFuture,
  onCancel,
}: {
  onDeleteOne: () => void;
  onDeleteFuture: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const confirmingRef = useRef(false);
  const confirm = (action: () => void) => {
    confirmingRef.current = true;
    action();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !confirmingRef.current && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.form_allocation_delete_repeated_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.form_allocation_delete_repeated_message({ shortcut: buildUndoShortcut() })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:grid sm:grid-cols-1">
          <AlertDialogCancel disabled={busy}>{m.form_cancel()}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} variant="danger-soft" onClick={() => confirm(onDeleteOne)}>
            {m.form_allocation_delete_occurrence()}
          </AlertDialogAction>
          <AlertDialogAction disabled={busy} variant="danger-soft" onClick={() => confirm(onDeleteFuture)}>
            {m.form_allocation_delete_occurrence_and_future()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
