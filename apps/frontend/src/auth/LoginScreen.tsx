import { ForgotPassword } from "./ForgotPassword";
import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { useEffect, useId, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "./LoginForm";
import { useOwnerSetup } from "./useOwnerSetup";
import { usePasswordSignIn } from "./usePasswordSignIn";

type LoginScreenProps = {
  authMode: "password-only" | "sso-only" | "password-and-sso";
  needsSetup?: boolean;
  passwordResetEmail?: boolean;
  degraded?: boolean;
  hadUnsavedChanges?: boolean;
  onSignedIn: () => void;
};

function useLoginIds() {
  return {
    name: useId(),
    email: useId(),
    password: useId(),
    setupToken: useId(),
    setupTokenHelp: useId(),
    error: useId(),
  };
}

/** Renders the public sign-in screen for the current auth mode. */
export function LoginScreen({
  authMode,
  needsSetup = false,
  passwordResetEmail = false,
  degraded = false,
  hadUnsavedChanges = false,
  onSignedIn,
}: LoginScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordSignIn = usePasswordSignIn({
    setError,
    setBusy,
    onSignedIn,
  });
  const ownerSetup = useOwnerSetup({
    email: passwordSignIn.email,
    password: passwordSignIn.password,
    setError,
    setBusy,
    onSignedIn,
  });
  const ids = useLoginIds();

  useEffect(() => {
    document.title = `${m.login_sign_in()} · ${APP_NAME}`;
  }, []);

  return (
    <LoginView
      authMode={authMode}
      needsSetup={needsSetup}
      passwordResetEmail={passwordResetEmail}
      degraded={degraded}
      hadUnsavedChanges={hadUnsavedChanges}
      busy={busy}
      error={error}
      setError={setError}
      ids={ids}
      passwordSignIn={passwordSignIn}
      ownerSetup={ownerSetup}
    />
  );
}

type LoginViewProps = {
  authMode: "password-only" | "sso-only" | "password-and-sso";
  needsSetup: boolean;
  passwordResetEmail: boolean;
  degraded: boolean;
  hadUnsavedChanges: boolean;
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  ids: {
    name: string;
    email: string;
    password: string;
    setupToken: string;
    setupTokenHelp: string;
    error: string;
  };
  passwordSignIn: ReturnType<typeof usePasswordSignIn>;
  ownerSetup: ReturnType<typeof useOwnerSetup>;
};

function LoginView(props: LoginViewProps) {
  const setup = isOwnerSetupActive(props);
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <LoginHeading setup={setup} />
        <Card className="gap-4 py-4">
          <CardContent className="px-4">
            <LoginNotices degraded={props.degraded} hadUnsavedChanges={props.hadUnsavedChanges} />
            <LoginForm
              authMode={props.authMode}
              setup={setup}
              passwordAutoFocus
              busy={props.busy}
              error={props.error}
              ids={props.ids}
              passwordSignIn={props.passwordSignIn}
              ownerSetup={props.ownerSetup}
            />
            {props.passwordResetEmail && allowsPasswordSignIn(props.authMode) && !setup && <ForgotPassword />}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function isOwnerSetupActive(props: LoginViewProps) {
  return allowsPasswordSignIn(props.authMode) && props.needsSetup && !props.ownerSetup.setupClosed;
}

function LoginHeading({ setup }: { setup: boolean }) {
  return (
    <div className="mb-6 text-center">
      <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
      <h1 className="text-lg font-semibold text-ink">{setup ? m.login_setup_heading() : m.login_sign_in()}</h1>
      {!setup && <p className="text-sm text-muted-foreground">{m.login_subtitle()}</p>}
    </div>
  );
}

function LoginNotices({ degraded, hadUnsavedChanges }: { degraded: boolean; hadUnsavedChanges: boolean }) {
  return (
    <>
      {degraded && (
        <div className="mb-4">
          <Alert variant="warn" role="status">
            <AlertDescription>{m.login_degraded_notice()}</AlertDescription>
          </Alert>
        </div>
      )}
      {hadUnsavedChanges && (
        <div className="mb-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription>{m.login_unsaved_changes_notice()}</AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}
