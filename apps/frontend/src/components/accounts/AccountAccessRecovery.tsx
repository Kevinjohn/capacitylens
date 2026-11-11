import { m } from '@/i18n';
import { useStore } from '@/store/useStore';

/** Shows loading or installation errors when no unambiguous active company is available. */
export function AccountAccessRecovery() {
  const accounts = useStore((state) => state.accountSummaries);
  const complete = useStore((state) => state.accountSummariesComplete);
  const ambiguous = useStore((state) => state.accountSummariesAmbiguous);

  if (!complete) {
    return (
      <main className="flex min-h-full items-center justify-center bg-canvas p-6">
        <p role="status" className="text-sm text-muted-foreground">
          {m.app_loading()}
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-6">
      <p role="alert" className="max-w-md text-center text-sm text-danger">
        {ambiguous || accounts.length > 1
          ? m.account_directory_ambiguous()
          : m.account_access_no_company_invite()}
      </p>
    </main>
  );
}
