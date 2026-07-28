import { useEffect, type ReactNode } from "react";
import { AccountPicker } from "./accounts/AccountPicker";
import { ConnectionError } from "./ConnectionError";
import { FakeSignIn } from "./FakeSignIn";
import { IntroPage } from "./IntroPage";
import { RotateHint } from "./RotateHint";
import { m } from "@/i18n";

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
  const stage =
    connectionError || loadError
      ? "error"
      : !hydrated
        ? "loading"
        : demoAuthActive && !fakeSignedIn
          ? "signin"
          : !hasActiveAccount
            ? "account"
            : !introSeen
              ? "intro"
              : "app";
  useEffect(() => {
    if (stage === "loading" || stage === "app") return;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("main input, main button, main a[href]")?.focus();
    });
  }, [stage]);

  if (connectionError || loadError) return <ConnectionError />;
  if (!hydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <p role="status" className="text-sm text-muted-foreground">
          {m.app_loading()}
        </p>
      </main>
    );
  }

  if (demoAuthActive && !fakeSignedIn) {
    return (
      <>
        <FakeSignIn onSignIn={onFakeSignIn} />
        <RotateHint />
      </>
    );
  }

  if (!hasActiveAccount) {
    return (
      <>
        <AccountPicker />
        <RotateHint />
      </>
    );
  }

  if (hasActiveAccount && !introSeen) {
    return (
      <>
        <IntroPage onContinue={onIntroContinue} />
        <RotateHint />
      </>
    );
  }

  return children;
}
