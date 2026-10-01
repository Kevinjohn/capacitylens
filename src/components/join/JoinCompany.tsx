import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m } from "@/i18n";
import { TextField } from "../common/ui";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FieldError } from "../ui/field";
import { useCompanyJoin } from "./useCompanyJoin";
import { ExternalProviderButton } from "../common/ExternalProviderButton";

type Flow = ReturnType<typeof useCompanyJoin>;

function Entry({ flow, invitationToken }: { flow: Flow; invitationToken: string | null }) {
  if (!flow.passwordAvailable && flow.eligibleProviders.length === 0) return <p>{m.joining_failed()}</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{m.joining_email_intro()}</p>
      <TextField
        label={m.login_email()}
        type="email"
        autoComplete="email"
        value={flow.email}
        onChange={flow.setEmail}
      />
      {flow.eligibleProviders.length > 0 && (
        <div className="flex flex-col gap-2">
          {flow.eligibleProviders.map((provider) => (
            <ExternalProviderButton
              key={provider.id}
              provider={provider}
              type="button"
              label={m.joining_continue_provider({ provider: provider.label })}
              googleLabel={m.login_sign_in_with_google()}
              microsoftLabel={m.login_sign_in_with_microsoft()}
              disabled={flow.busy}
              onClick={() => void flow.startProvider(provider)}
            />
          ))}
        </div>
      )}
      {flow.passwordAvailable &&
        (invitationToken ? (
          <a className="text-sm text-brand underline" href={`/invite/${encodeURIComponent(invitationToken)}`}>
            {m.joining_use_invitation()}
          </a>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(event) => void flow.signInAndJoin(event)}>
            {flow.eligibleProviders.length > 0 && (
              <p className="text-center text-xs text-muted-foreground">{m.joining_password_choice()}</p>
            )}
            {flow.user ? (
              <p className="text-sm text-muted-foreground">{flow.user.email}</p>
            ) : (
              <TextField
                label={m.login_password()}
                type="password"
                autoComplete="current-password"
                value={flow.existingPassword}
                onChange={flow.setExistingPassword}
              />
            )}
            <Button type="submit" disabled={flow.busy}>
              {m.joining_join_company()}
            </Button>
          </form>
        ))}
    </div>
  );
}

function Pending({ flow }: { flow: Flow }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{m.joining_mail_pending({ email: flow.emailHint })}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={flow.busy} onClick={() => void flow.resend()}>
          {m.joining_resend()}
        </Button>
        <Button type="button" variant="outline" disabled={flow.busy} onClick={() => void flow.restart()}>
          {m.joining_restart()}
        </Button>
      </div>
    </div>
  );
}

function Approved({ flow }: { flow: Flow }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{m.joining_provider_approved()}</p>
      <Button type="button" disabled={flow.busy} onClick={() => void flow.completeProvider()}>
        {m.joining_join_company()}
      </Button>
    </div>
  );
}

function SecondFactor({ flow }: { flow: Flow }) {
  if (flow.secondFactorVerified) {
    return (
      <form className="flex flex-col gap-3" onSubmit={(event) => void flow.verifySecondFactor(event)}>
        <p className="text-sm text-muted-foreground">{m.joining_mfa_complete()}</p>
        <Button type="submit" disabled={flow.busy}>
          {m.joining_join_company()}
        </Button>
      </form>
    );
  }
  const prompt = flow.useRecoveryCode ? m.login_mfa_recovery_prompt() : m.login_mfa_authenticator_prompt();
  const label = flow.useRecoveryCode ? m.login_mfa_recovery_code() : m.login_mfa_authentication_code();
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void flow.verifySecondFactor(event)}>
      <p className="text-sm text-muted-foreground">{prompt}</p>
      <TextField
        label={label}
        type="text"
        autoComplete="one-time-code"
        value={flow.secondFactorCode}
        onChange={(value) => flow.setSecondFactorCode(value.trim())}
      />
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={flow.busy}
          onClick={() => {
            flow.setUseRecoveryCode(!flow.useRecoveryCode);
            flow.setSecondFactorCode("");
          }}
        >
          {flow.useRecoveryCode ? m.login_mfa_use_authenticator() : m.login_mfa_use_recovery()}
        </Button>
        <Button type="submit" disabled={flow.busy || !flow.secondFactorCode}>
          {m.login_mfa_verify()}
        </Button>
      </div>
    </form>
  );
}

function JoinContent({ flow, invitationToken }: { flow: Flow; invitationToken: string | null }) {
  switch (flow.stage) {
    case "entry":
      return <Entry flow={flow} invitationToken={invitationToken} />;
    case "pending":
      return <Pending flow={flow} />;
    case "approved":
      return <Approved flow={flow} />;
    case "second-factor":
      return <SecondFactor flow={flow} />;
    case "local":
      return <p>{m.invite_local_mode({ app: APP_NAME })}</p>;
    case "error":
      return (
        <Button type="button" onClick={() => window.location.reload()}>
          {m.joining_policy_retry()}
        </Button>
      );
    case "loading":
      return <p role="status">{m.joining_waiting()}</p>;
    case "joined":
      return <p role="status">{m.joining_join_company()}</p>;
  }
}

function JoinCompanyForAccount({ accountId, invitationToken }: { accountId: string; invitationToken: string | null }) {
  const flow = useCompanyJoin(accountId, invitationToken);
  useEffect(() => {
    document.title = `${flow.metadata?.companyName ?? m.joining_waiting()} · ${APP_NAME}`;
  }, [flow.metadata?.companyName]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-lg">
        <Card>
          <CardHeader className="text-center">
            <div className="text-2xl font-bold text-brand">{APP_NAME}</div>
            <CardTitle>
              <h1>{flow.metadata ? m.joining_title({ company: flow.metadata.companyName }) : m.joining_waiting()}</h1>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FieldError>{flow.error}</FieldError>
            <JoinContent flow={flow} invitationToken={invitationToken} />
            {flow.emailProofRequired && flow.emailVerificationAvailable && (
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  data-testid="joining-verify-email"
                  disabled={flow.busy}
                  onClick={() => void flow.requestEmailVerification()}
                >
                  {m.joining_verify_email()}
                </Button>
                {flow.verificationSent && (
                  <p role="status" data-testid="joining-verify-email-status" className="text-sm text-muted-foreground">
                    {m.joining_verify_email_sent()}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

export function JoinCompany() {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get("invite");
  return (
    <JoinCompanyForAccount
      key={`${accountId ?? ""}:${invitationToken ?? ""}`}
      accountId={accountId ?? ""}
      invitationToken={invitationToken}
    />
  );
}
