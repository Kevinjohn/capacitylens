import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AccountAccessRecovery } from './company/AccountAccessRecovery';
import { AccountLoadRecovery } from './company/AccountLoadRecovery';
import { RotateHint } from './RotateHint';
import { m } from '@/i18n';

function LoadingBoundary() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <p role="status" className="text-sm text-muted-foreground">
        {m.app_loading()}
      </p>
    </main>
  );
}

function FocusableStage({ children }: { children: ReactNode }) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('main input, main button, main a[href]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  return children;
}

interface AppEntryGateProps {
  hydrated: boolean;
  hasActiveCompany: boolean;
  ambiguousAccountDirectory: boolean;
  allowWithoutActiveCompany: boolean;
  activeCompanyId: string | null;
  activeCompanyLoadFailed: string | null;
  activeCompanyName: string;
  onRetryActiveCompanyLoad: () => Promise<boolean>;
  children: ReactNode;
}

/** Expresses the mutually-exclusive app entry sequence in one ordered boundary. */
export function AppEntryGate({
  hydrated,
  hasActiveCompany,
  ambiguousAccountDirectory,
  allowWithoutActiveCompany,
  activeCompanyId,
  activeCompanyLoadFailed,
  activeCompanyName,
  onRetryActiveCompanyLoad,
  children,
}: AppEntryGateProps) {
  if (!hydrated) return <LoadingBoundary />;

  if (activeCompanyLoadFailed !== null && activeCompanyLoadFailed === activeCompanyId) {
    return (
      <FocusableStage>
        <AccountLoadRecovery accountName={activeCompanyName} onRetry={onRetryActiveCompanyLoad} />
      </FocusableStage>
    );
  }

  if (ambiguousAccountDirectory || (!hasActiveCompany && !allowWithoutActiveCompany)) {
    return (
      <FocusableStage>
        <AccountAccessRecovery />
        <RotateHint />
      </FocusableStage>
    );
  }

  return children;
}
