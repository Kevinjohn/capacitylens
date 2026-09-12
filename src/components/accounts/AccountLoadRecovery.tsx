import { m } from "@/i18n";
import { Button } from "../ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";

export function AccountLoadRecovery({
  accountName,
  onRetry,
  onChooseAnother,
}: {
  accountName: string;
  onRetry: () => void;
  onChooseAnother: () => void;
}) {
  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6" data-testid="account-load-recovery">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1>{m.account_load_failed_title({ company: accountName })}</h1>
          </CardTitle>
          <CardDescription>{m.account_load_failed_body()}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onChooseAnother}>
            {m.account_load_choose_another()}
          </Button>
          <Button size="sm" onClick={onRetry}>
            {m.account_load_retry()}
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
