import { useEffect, useSyncExternalStore } from "react";
import { m } from "@/i18n";
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
import {
  completeRestorationCleanup,
  readRestorationCleanupCount,
  subscribeRestorationCleanup,
} from "./restorationCleanupConfirmation";

/** Keeps a pending save in its original editor until the company-wide Restore loss is accepted. */
export function RestorationCleanupDialog() {
  const count = useSyncExternalStore(subscribeRestorationCleanup, readRestorationCleanupCount);
  useEffect(() => () => completeRestorationCleanup(false), []);
  if (count === null) return null;
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) completeRestorationCleanup(false);
      }}
    >
      <AlertDialogContent data-testid="restoration-cleanup-confirmation">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1 ? m.restoration_cleanup_title_single() : m.restoration_cleanup_title({ count })}
          </AlertDialogTitle>
          <AlertDialogDescription>{m.restoration_cleanup_description()}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => completeRestorationCleanup(false)}>{m.form_cancel()}</AlertDialogCancel>
          <AlertDialogAction onClick={() => completeRestorationCleanup(true)}>
            {m.restoration_cleanup_save()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
