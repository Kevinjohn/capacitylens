import { useRef } from "react";
import { m } from "@/i18n";
import { undoShortcut } from "../../lib/keyboardShortcuts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

export function RepeatedAllocationDeleteDialog({
  onDeleteOne,
  onDeleteFuture,
  onCancel,
}: {
  onDeleteOne: () => void;
  onDeleteFuture: () => void;
  onCancel: () => void;
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
        if (!open && !confirmingRef.current) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{m.form_allocation_delete_repeated_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {m.form_allocation_delete_repeated_message({ shortcut: undoShortcut() })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:grid sm:grid-cols-1">
          <AlertDialogCancel>{m.form_cancel()}</AlertDialogCancel>
          <AlertDialogAction variant="danger-soft" onClick={() => confirm(onDeleteOne)}>
            {m.form_allocation_delete_occurrence()}
          </AlertDialogAction>
          <AlertDialogAction variant="danger-soft" onClick={() => confirm(onDeleteFuture)}>
            {m.form_allocation_delete_occurrence_and_future()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
