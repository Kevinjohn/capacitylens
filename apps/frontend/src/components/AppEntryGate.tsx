import { lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { AccountPicker } from './accounts/AccountPicker';
import { AccountLoadRecovery } from './accounts/AccountLoadRecovery';
import { ConnectionError } from './ConnectionError';
import { RotateHint } from './RotateHint';
import { m } from '@/i18n';

const StorageRecovery = lazy(async () => {
  const module = await import('./StorageRecovery');
  return { default: module.StorageRecovery };
});

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
  connectionError: boolean;
  loadError: boolean;
  demoAuthActive: boolean;
  hasActiveAccount: boolean;
  allowWithoutActiveAccount: boolean;
  activeAccountId: string | null;
  activeAccountLoadFailed: string | null;
  activeAccountName: string;
  onRetryActiveAccountLoad: () => Promise<boolean>;
  onChooseAnotherAccount: () => void;
  children: ReactNode;
}

/** Expresses the mutually-exclusive app entry sequence in one ordered boundary. */
export function AppEntryGate({
  hydrated,
  connectionError,
  loadError,
  demoAuthActive,
  hasActiveAccount,
  allowWithoutActiveAccount,
  activeAccountId,
  activeAccountLoadFailed,
  activeAccountName,
  onRetryActiveAccountLoad,
  onChooseAnotherAccount,
  children,
}: AppEntryGateProps) {
  if (connectionError) {
    return (
      <FocusableStage>
        <ConnectionError />
      </FocusableStage>
    );
  }
  if (loadError) {
    return (
      <Suspense fallback={<LoadingBoundary />}>
        <FocusableStage>
          <StorageRecovery />
        </FocusableStage>
      </Suspense>
    );
  }
  if (!hydrated) return <LoadingBoundary />;

  if (activeAccountLoadFailed !== null && activeAccountLoadFailed === activeAccountId) {
    return (
      <FocusableStage>
        <AccountLoadRecovery
          accountName={activeAccountName}
          onRetry={onRetryActiveAccountLoad}
          {...(demoAuthActive ? { onChooseAnother: onChooseAnotherAccount } : {})}
        />
      </FocusableStage>
    );
  }

  if (!hasActiveAccount && !allowWithoutActiveAccount) {
    return (
      <FocusableStage>
        <AccountPicker />
        <RotateHint />
      </FocusableStage>
    );
  }

  return children;
}
