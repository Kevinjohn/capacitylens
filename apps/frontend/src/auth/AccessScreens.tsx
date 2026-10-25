import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuthUser } from "./authContext";
import { authClient } from "./authClient";
import type { AccessGate, AdmissionSummary } from "./authStatus";

type AccessScreenProps = {
  gate: AccessGate;
  user: AuthUser | null;
  admission?: AdmissionSummary;
  onSignOut: () => Promise<void> | void;
  onRefresh: () => Promise<void>;
};

/**
 * The limited surface for a signed-in identity that may not reach company data yet. It offers
 * only the step that applies: confirm the address, ask for or wait on admission, or join the
 * company. The server enforces every gate; this screen only explains the current one.
 */
export function AccessScreen(props: AccessScreenProps) {
  useEffect(() => {
    document.title = `${m.limited_title()} · ${APP_NAME}`;
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-md" data-testid={`access-${props.gate}`}>
        <Card>
          <CardHeader className="text-center">
            <div className="text-2xl font-bold text-brand">{APP_NAME}</div>
            <CardTitle>
              <h1>{heading(props.gate)}</h1>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {props.user?.email && (
              <p className="text-sm text-muted-foreground">{m.limited_signed_in_as({ email: props.user.email })}</p>
            )}
            <GateContent {...props} />
            <Button type="button" variant="link" onClick={() => void props.onSignOut()}>
              {m.limited_sign_out()}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function heading(gate: AccessGate) {
  if (gate === "verify-email") return m.limited_verify_heading();
  if (gate === "admission") return m.limited_admission_heading();
  return m.limited_membership_heading();
}

function GateContent(props: AccessScreenProps) {
  if (props.gate === "verify-email") return <VerifyEmailStep />;
  if (props.gate === "admission") return <AdmissionStep admission={props.admission} onRefresh={props.onRefresh} />;
  return <MembershipStep onRefresh={props.onRefresh} />;
}

/** Runs one request at a time and keeps its outcome message. */
function useStep() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (failure) {
      console.warn("AccessScreen: request failed", failure);
      setError(m.login_network_error());
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, notice, setNotice, run };
}

function StepMessages({ error, notice }: { error: string | null; notice: string | null }): ReactNode {
  return (
    <>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground" data-testid="access-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function VerifyEmailStep() {
  const step = useStep();
  return (
    <>
      <p className="text-sm">{m.limited_verify_body()}</p>
      <Button
        type="button"
        data-testid="access-send-verification"
        disabled={step.busy}
        onClick={() =>
          void step.run(async () => {
            const { error } = await authClient.sendEmailVerification();
            if (error) step.setError(error.code === "MAIL_UNAVAILABLE" ? m.limited_mail_unavailable() : error.message);
            else step.setNotice(m.limited_verify_sent());
          })
        }
      >
        {m.limited_verify_send()}
      </Button>
      <StepMessages error={step.error} notice={step.notice} />
    </>
  );
}

function AdmissionStep({
  admission,
  onRefresh,
}: {
  admission: AdmissionSummary | undefined;
  onRefresh: () => Promise<void>;
}) {
  const step = useStep();
  const refused = admission?.approvalStatus === "rejected" || admission?.approvalStatus === "revoked";
  if (refused) return <p className="text-sm">{m.limited_admission_refused()}</p>;
  return (
    <>
      <p className="text-sm">{admission?.requested ? m.limited_admission_waiting() : m.limited_admission_body()}</p>
      {!admission?.requested && (
        <Button
          type="button"
          data-testid="access-request-admission"
          disabled={step.busy}
          onClick={() =>
            void step.run(async () => {
              const { error } = await authClient.requestAdmission();
              if (error) step.setError(error.message);
              else await onRefresh();
            })
          }
        >
          {m.limited_admission_request()}
        </Button>
      )}
      <Button type="button" variant="outline" disabled={step.busy} onClick={() => void step.run(onRefresh)}>
        {m.limited_check_again()}
      </Button>
      <StepMessages error={step.error} notice={step.notice} />
    </>
  );
}

function MembershipStep({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const step = useStep();
  return (
    <>
      <p className="text-sm">{m.limited_membership_body()}</p>
      <Button
        type="button"
        data-testid="access-join-company"
        disabled={step.busy}
        onClick={() =>
          void step.run(async () => {
            const { error } = await authClient.completeMembership();
            if (error) step.setError(error.message);
            else await onRefresh();
          })
        }
      >
        {m.limited_membership_join()}
      </Button>
      <StepMessages error={step.error} notice={step.notice} />
    </>
  );
}
