import { useState } from "react";
import { APP_NAME } from "@capacitylens/shared/brand";
import { clearCapacitylensLocalStorage, readCapacitylensLocalStorage } from "@/data/clearLocalStorage";
import { downloadTextFile } from "@/lib/download";
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
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";

interface StorageRecoveryProps {
  onDownload?: () => void;
  onReset?: () => void | Promise<void>;
}

interface StorageResetDependencies {
  clearLocalStorage?: () => void;
  reload?: () => void;
}

type StorageRecoveryError = "download" | "reset";

interface StorageRecoveryActionsProps {
  resetting: boolean;
  download: () => void;
  reset: () => Promise<void>;
}

// Exported beside the recovery boundary so its injected reset path can be tested without mutating
// real browser storage.
/** Identifies a local storage reset failure for the recovery screen. */
// eslint-disable-next-line react-refresh/only-export-components
export class StorageResetError extends Error {
  constructor(cause?: unknown) {
    super("Browser storage could not be reset.", { cause });
    this.name = "StorageResetError";
  }
}

function downloadRawStorage(): void {
  const recoveryCopy = {
    format: "local-storage-recovery-v1",
    createdAt: new Date().toISOString(),
    entries: readCapacitylensLocalStorage(),
  };
  const date = recoveryCopy.createdAt.slice(0, 10);
  downloadTextFile(`${APP_NAME.toLowerCase()}-recovery-${date}.json`, JSON.stringify(recoveryCopy, null, 2));
}

function captureAttempt<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return Promise.resolve(operation());
  } catch (error) {
    // Convert synchronous injected reset failure into rejection so callers share one asynchronous error boundary.
    return Promise.reject(error);
  }
}

/** Clears local application data before recovery proceeds; a failure leaves recovery incomplete. */
// eslint-disable-next-line react-refresh/only-export-components -- see the test-boundary note above
export async function resetLocalStorage({
  clearLocalStorage = clearCapacitylensLocalStorage,
  reload = () => window.location.reload(),
}: StorageResetDependencies = {}): Promise<void> {
  try {
    await captureAttempt(clearLocalStorage);
  } catch (cause) {
    throw new StorageResetError(cause);
  }
  reload();
}

function resolveErrorMessage(error: StorageRecoveryError): string {
  if (error === "download") return m.storage_download_error();
  return m.storage_reset_error();
}

function StorageRecoveryActions({ resetting, download, reset }: StorageRecoveryActionsProps) {
  return (
    <CardFooter className="flex-wrap justify-end gap-2">
      <Button size="sm" variant="outline" onClick={download} disabled={resetting}>
        {m.storage_download()}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={resetting}>
            {m.storage_reset()}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{m.storage_reset_confirm_title()}</AlertDialogTitle>
            <AlertDialogDescription>{m.storage_reset_confirm_message({ app: APP_NAME })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>{m.form_cancel()}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={resetting} onClick={() => void reset()}>
              {m.storage_reset_confirm_label()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardFooter>
  );
}

/** Recovery boundary for unreadable local bytes. Nothing is changed until reset is confirmed. */
export function StorageRecovery({
  onDownload = downloadRawStorage,
  onReset = resetLocalStorage,
}: StorageRecoveryProps = {}) {
  const [error, setError] = useState<StorageRecoveryError | null>(null);
  const [resetting, setResetting] = useState(false);

  const download = () => {
    try {
      onDownload();
      setError(null);
    } catch {
      // Expose a failed backup download without advancing into reset.
      setError("download");
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      await onReset();
      setError(null);
      setResetting(false);
    } catch {
      // Surface a failed reset and release busy state so recovery remains usable.
      setError("reset");
      setResetting(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>
            <h1>{m.storage_title()}</h1>
          </CardTitle>
          <CardDescription>{m.storage_body({ app: APP_NAME })}</CardDescription>
          {error !== null && (
            <p role="alert" className="text-sm text-danger">
              {resolveErrorMessage(error)}
            </p>
          )}
        </CardHeader>
        <StorageRecoveryActions resetting={resetting} download={download} reset={reset} />
      </Card>
    </main>
  );
}
