import { useState } from "react";
import { m } from "@/i18n";
import { Button } from "../ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";

export function AccountLoadRecovery({
  accountName,
  onRetry,
  onChooseAnother,
}: {
  accountName: string;
  onRetry: () => Promise<boolean>;
  onChooseAnother: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  // Local-only: this recovery stage renders instead of the app shell's own children, so the
  // shared persist-error banner (rendered inside those children) never reaches the user here.
  // A failed retry needs its own inline feedback rather than a restructure of that boundary.
  const [retryFailed, setRetryFailed] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    setRetryFailed(false);
    void onRetry()
      .then((succeeded) => {
        if (!succeeded) setRetryFailed(true);
      })
      .finally(() => setRetrying(false));
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6" data-testid="account-load-recovery">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>{m.account_load_failed_title({ company: accountName })}</h1>
          </CardTitle>
          <CardDescription>{m.account_load_failed_body()}</CardDescription>
        </CardHeader>
        <CardFooter className="flex-col items-end gap-2">
          {retryFailed && (
            <p role="alert" className="text-sm text-danger">
              {m.account_load_retry_failed()}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onChooseAnother}>
              {m.account_load_choose_another()}
            </Button>
            <Button size="sm" onClick={handleRetry} disabled={retrying}>
              {m.account_load_retry()}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </main>
  );
}
