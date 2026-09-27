import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m } from "@/i18n";
import { TextField } from "../common/ui";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { FieldError } from "../ui/field";
import { useCompanyJoin } from "./useCompanyJoin";

type Flow = ReturnType<typeof useCompanyJoin>;

function Entry({ flow }: { flow: Flow }) {
  if (!flow.metadata?.passwordAvailable) return <p>{m.joining_failed()}</p>;
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => void flow.start(event)}>
      <p className="text-sm text-muted-foreground">{m.joining_email_intro()}</p>
      <TextField label={m.login_email()} type="email" autoComplete="email" value={flow.email}
        onChange={flow.setEmail} />
      <Button type="submit" disabled={flow.busy}>{m.joining_send_email()}</Button>
    </form>
  );
}

function Pending({ flow }: { flow: Flow }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{m.joining_mail_pending({ email: flow.emailHint })}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={flow.busy} onClick={() => void flow.resend()}>{m.joining_resend()}</Button>
        <Button type="button" variant="outline" disabled={flow.busy} onClick={() => void flow.restart()}>
          {m.joining_restart()}
        </Button>
      </div>
    </div>
  );
}

function Approved({ flow }: { flow: Flow }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{m.joining_verified()}</p>
      {flow.metadata?.passwordAvailable && (
        <form className="flex flex-col gap-3" onSubmit={(event) => void flow.createAccount(event)}>
          <h2 className="font-medium">{m.invite_create_account_tab()}</h2>
          <TextField label={m.invite_name()} autoComplete="name" value={flow.displayName}
            onChange={flow.setDisplayName} />
          <TextField label={m.login_password()} type="password" autoComplete="new-password"
            value={flow.password} onChange={flow.setPassword} />
          <Button type="submit" disabled={flow.busy}>{m.joining_create_account()}</Button>
        </form>
      )}
      <form className="flex flex-col gap-3 border-t pt-4" onSubmit={(event) => void flow.signInAndJoin(event)}>
        <h2 className="font-medium">{m.joining_existing_account()}</h2>
        {flow.user ? <p className="text-sm text-muted-foreground">{flow.user.email}</p> :
          <TextField label={m.login_password()} type="password" autoComplete="current-password"
            value={flow.existingPassword} onChange={flow.setExistingPassword} />}
        <Button type="submit" variant="outline" disabled={flow.busy}>{m.joining_join_company()}</Button>
      </form>
    </div>
  );
}

function JoinContent({ flow }: { flow: Flow }) {
  switch (flow.stage) {
    case "entry": return <Entry flow={flow} />;
    case "pending": return <Pending flow={flow} />;
    case "approved": return <Approved flow={flow} />;
    case "local": return <p>{m.invite_local_mode({ app: APP_NAME })}</p>;
    case "error": return <Button type="button" onClick={() => window.location.reload()}>{m.joining_policy_retry()}</Button>;
    case "loading": return <p role="status">{m.joining_waiting()}</p>;
    case "joined": return <p role="status">{m.joining_join_company()}</p>;
  }
}

function JoinCompanyForAccount({ accountId, invitationToken }: { accountId: string; invitationToken: string | null }) {
  const flow = useCompanyJoin(accountId, invitationToken);
  useEffect(() => { document.title = `${flow.metadata?.companyName ?? m.joining_waiting()} · ${APP_NAME}`; },
    [flow.metadata?.companyName]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-lg">
        <Card>
          <CardHeader className="text-center">
            <div className="text-2xl font-bold text-brand">{APP_NAME}</div>
            <CardTitle><h1>{flow.metadata ? m.joining_title({ company: flow.metadata.companyName }) :
              m.joining_waiting()}</h1></CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FieldError>{flow.error}</FieldError>
            <JoinContent flow={flow} />
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
  return <JoinCompanyForAccount key={`${accountId ?? ""}:${invitationToken ?? ""}`}
    accountId={accountId ?? ""} invitationToken={invitationToken} />;
}
