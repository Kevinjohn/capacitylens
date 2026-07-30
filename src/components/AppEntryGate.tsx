import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { AccountPicker } from "./accounts/AccountPicker";
import { ConnectionError } from "./ConnectionError";
import { FakeSignIn } from "./FakeSignIn";
import { RotateHint } from "./RotateHint";
import { m } from "@/i18n";

const IntroPage = lazy(async () => ({
  default: (await import("./IntroPage")).IntroPage,
}));

const StorageRecovery = lazy(async () => ({
  default: (await import("./StorageRecovery")).StorageRecovery,
}));

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
      document.querySelector<HTMLElement>("main input, main button, main a[href]")?.focus();
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
  fakeSignedIn: boolean;
  hasActiveAccount: boolean;
  introSeen: boolean;
  onFakeSignIn: () => void;
  onIntroContinue: () => void;
  children: ReactNode;
}

/** Expresses the mutually-exclusive app entry sequence in one ordered boundary. */
export function AppEntryGate({
  hydrated,
  connectionError,
  loadError,
  demoAuthActive,
  fakeSignedIn,
  hasActiveAccount,
  introSeen,
  onFakeSignIn,
  onIntroContinue,
  children,
}: AppEntryGateProps) {
  if (connectionError)
    return (
      <FocusableStage>
        <ConnectionError />
      </FocusableStage>
    );
  if (loadError)
    return (
      <Suspense fallback={<LoadingBoundary />}>
        <FocusableStage>
          <StorageRecovery />
        </FocusableStage>
      </Suspense>
    );
  if (!hydrated) return <LoadingBoundary />;

  if (demoAuthActive && !fakeSignedIn) {
    return (
      <FocusableStage>
        <FakeSignIn onSignIn={onFakeSignIn} />
        <RotateHint />
      </FocusableStage>
    );
  }

  if (!hasActiveAccount) {
    return (
      <FocusableStage>
        <AccountPicker />
        <RotateHint />
      </FocusableStage>
    );
  }

  if (hasActiveAccount && !introSeen) {
    return (
      <Suspense fallback={<LoadingBoundary />}>
        <FocusableStage>
          <IntroPage onContinue={onIntroContinue} />
          <RotateHint />
        </FocusableStage>
      </Suspense>
    );
  }

  return children;
}
