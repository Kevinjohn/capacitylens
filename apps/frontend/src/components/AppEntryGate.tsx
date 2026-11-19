import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { CompanyAccessRecovery } from './company/CompanyAccessRecovery';
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
  ambiguousCompanyDirectory: boolean;
  allowWithoutActiveCompany: boolean;
  children: ReactNode;
}

/** Expresses the mutually-exclusive app entry sequence in one ordered boundary. */
export function AppEntryGate({
  hydrated,
  hasActiveCompany,
  ambiguousCompanyDirectory,
  allowWithoutActiveCompany,
  children,
}: AppEntryGateProps) {
  if (!hydrated) return <LoadingBoundary />;

  if (ambiguousCompanyDirectory || (!hasActiveCompany && !allowWithoutActiveCompany)) {
    return (
      <FocusableStage>
        <CompanyAccessRecovery />
        <RotateHint />
      </FocusableStage>
    );
  }

  return children;
}
