import { ForgotPassword } from './ForgotPassword';
import { m } from '@/i18n';
import { APP_NAME } from '@capacitylens/shared/brand';
import { useEffect, useId, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { SignInForm } from './SignInForm';
import { usePasswordSignIn } from './usePasswordSignIn';

type SignInScreenProps = {
  needsSetup?: boolean;
  passwordResetEmail?: boolean;
  degraded?: boolean;
  hadUnsavedChanges?: boolean;
  onSignedIn: () => void;
};

function useSignInIds() {
  return { email: useId(), password: useId(), error: useId() };
}

/** Renders the public password sign-in screen. */
export function SignInScreen({
  needsSetup = false,
  passwordResetEmail = false,
  degraded = false,
  hadUnsavedChanges = false,
  onSignedIn,
}: SignInScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordSignIn = usePasswordSignIn({
    setError,
    setBusy,
    onSignedIn,
  });
  const ids = useSignInIds();

  useEffect(() => {
    document.title = `${m.sign_in_button()} · ${APP_NAME}`;
  }, []);

  return (
    <SignInView
      needsSetup={needsSetup}
      passwordResetEmail={passwordResetEmail}
      degraded={degraded}
      hadUnsavedChanges={hadUnsavedChanges}
      busy={busy}
      error={error}
      setError={setError}
      ids={ids}
      passwordSignIn={passwordSignIn}
    />
  );
}

type SignInViewProps = {
  needsSetup: boolean;
  passwordResetEmail: boolean;
  degraded: boolean;
  hadUnsavedChanges: boolean;
  busy: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  ids: { email: string; password: string; error: string };
  passwordSignIn: ReturnType<typeof usePasswordSignIn>;
};

function SignInView(props: SignInViewProps) {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <SignInHeading />
        <Card className="gap-4 py-4">
          <CardContent className="px-4">
            <SignInNotices
              degraded={props.degraded}
              hadUnsavedChanges={props.hadUnsavedChanges}
              needsSetup={props.needsSetup}
            />
            <SignInForm
              passwordAutoFocus
              busy={props.busy}
              error={props.error}
              ids={props.ids}
              passwordSignIn={props.passwordSignIn}
            />
            {props.passwordResetEmail && <ForgotPassword />}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function SignInHeading() {
  return (
    <div className="mb-6 text-center">
      <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
      <h1 className="text-lg font-semibold text-ink">{m.sign_in_button()}</h1>
      <p className="text-sm text-muted-foreground">{m.sign_in_subtitle()}</p>
    </div>
  );
}

type SignInNoticesProps = { degraded: boolean; hadUnsavedChanges: boolean; needsSetup: boolean };

function SignInNotices({ degraded, hadUnsavedChanges, needsSetup }: SignInNoticesProps) {
  return (
    <>
      {needsSetup && (
        <div className="mb-4">
          <Alert role="status" data-testid="sign-in-setup-needed">
            <AlertDescription>{m.sign_in_setup_link_needed({ app: APP_NAME })}</AlertDescription>
          </Alert>
        </div>
      )}
      {degraded && (
        <div className="mb-4">
          <Alert variant="warn" role="status">
            <AlertDescription>{m.sign_in_degraded_notice()}</AlertDescription>
          </Alert>
        </div>
      )}
      {hadUnsavedChanges && (
        <div className="mb-4">
          <Alert variant="destructive" role="alert">
            <AlertDescription>{m.sign_in_unsaved_changes_notice()}</AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
}
