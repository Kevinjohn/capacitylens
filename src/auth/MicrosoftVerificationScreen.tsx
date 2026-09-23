import { useCallback, useEffect, useState, type ReactNode } from "react";
import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { FieldError } from "../components/ui/field";
import {
  cancelMicrosoftConnection,
  confirmMicrosoftConnection,
  getMicrosoftConnectionStatus,
  resendMicrosoftConnection,
  type MicrosoftConnectionStatus,
} from "./microsoftConnectionClient";

type VerificationViewState = {
  token: string | null;
  status: MicrosoftConnectionStatus | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  cancelled: boolean;
  refreshStatus: (signal?: AbortSignal) => Promise<void>;
  confirm: () => Promise<void>;
  resend: () => Promise<void>;
  cancel: () => Promise<void>;
};

export function MicrosoftVerificationScreen() {
  return <MicrosoftVerificationView {...useMicrosoftVerification()} />;
}

function useMicrosoftVerification(): VerificationViewState {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<MicrosoftConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const refreshStatus = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const nextStatus = await getMicrosoftConnectionStatus(signal);
      if (!signal?.aborted) setStatus(nextStatus);
    } catch {
      if (!signal?.aborted) {
        setStatus(null);
        setError(m.microsoft_verify_unavailable());
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const proof = new URLSearchParams(window.location.hash.slice(1)).get("token");
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
    // Defer state updates until the effect has completed; this also preserves the first capture
    // through StrictMode's effect replay after the browser fragment has been removed.
    if (proof) void Promise.resolve().then(() => setToken(proof));
    document.title = `${m.microsoft_verify_title()} · ${APP_NAME}`;
    const controller = new AbortController();
    void Promise.resolve().then(() => refreshStatus(controller.signal));
    return () => controller.abort();
  }, [refreshStatus]);

  const confirm = useCallback(async () => {
    if (!token && status?.state !== "approved") return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmMicrosoftConnection(token ?? undefined);
      window.location.assign(result.url);
    } catch {
      setError(m.microsoft_verify_action_failed());
      setBusy(false);
    }
  }, [status, token]);

  const resend = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await resendMicrosoftConnection();
      setToken(null);
      setStatus((current) => (current ? { ...current, deliveryUnavailable: false } : current));
      setNotice(m.microsoft_verify_resent());
    } catch {
      setError(m.microsoft_verify_action_failed());
    } finally {
      setBusy(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelMicrosoftConnection();
      setToken(null);
      setCancelled(true);
      setStatus({ state: "expired" });
    } catch {
      setError(m.microsoft_verify_action_failed());
    } finally {
      setBusy(false);
    }
  }, []);

  return { token, status, loading, busy, error, notice, cancelled, refreshStatus, confirm, resend, cancel };
}

function VerificationStatusText({
  loading,
  status,
  cancelled,
}: Pick<VerificationViewState, "loading" | "status" | "cancelled">) {
  if (loading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {m.microsoft_verify_checking()}
      </p>
    );
  if (status?.state === "expired") {
    const text = cancelled ? m.microsoft_verify_cancelled() : m.microsoft_verify_expired();
    return <p className="text-sm text-muted-foreground">{text}</p>;
  }
  if (status?.state === "approved") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {m.microsoft_verify_approved()}
      </p>
    );
  }
  return null;
}

function ConfirmationButton({
  loading,
  expired,
  token,
  busy,
  confirm,
  status,
}: Pick<VerificationViewState, "loading" | "token" | "busy" | "confirm" | "status"> & { expired: boolean }) {
  if (loading || !status || expired || (!token && status.state !== "approved")) return null;
  const text = status.state === "approved" ? m.microsoft_verify_continue() : m.microsoft_verify_confirm();
  return (
    <Button type="button" disabled={busy} onClick={() => void confirm()}>
      {text}
    </Button>
  );
}

function PendingRequestButtons({
  loading,
  status,
  busy,
  resend,
  cancel,
}: Pick<VerificationViewState, "loading" | "status" | "busy" | "resend" | "cancel">) {
  if (loading || !status || status.state === "expired") return null;
  return (
    <>
      {status.state === "pending" && (
        <Button type="button" variant="outline" disabled={busy} onClick={() => void resend()}>
          {m.microsoft_verify_resend()}
        </Button>
      )}
      <Button type="button" variant="ghost" disabled={busy} onClick={() => void cancel()}>
        {m.microsoft_verify_cancel()}
      </Button>
    </>
  );
}

function RetryButton({
  loading,
  busy,
  refreshStatus,
}: Pick<VerificationViewState, "loading" | "busy" | "refreshStatus">) {
  if (loading) return null;
  return (
    <Button type="button" variant="link" disabled={busy} onClick={() => void refreshStatus()}>
      {m.common_try_again()}
    </Button>
  );
}

function ExpiredRestart({ expired, loading }: { expired: boolean; loading: boolean }) {
  if (loading || !expired) return null;
  return (
    <Button asChild variant="outline">
      <a href="/">{m.microsoft_verify_restart()}</a>
    </Button>
  );
}

function VerificationActions(props: VerificationViewState) {
  const expired = props.status?.state === "expired";
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmationButton {...props} expired={expired} />
      <PendingRequestButtons {...props} />
      <RetryButton {...props} />
      <ExpiredRestart expired={expired} loading={props.loading} />
    </div>
  );
}

function VerificationBody({
  status,
  loading,
  error,
  notice,
  cancelled,
  actions,
}: Pick<VerificationViewState, "status" | "loading" | "error" | "notice" | "cancelled"> & {
  actions: ReactNode;
}) {
  const statusText = VerificationStatusText({ loading, status, cancelled });
  return (
    <Card className="gap-4 py-4">
      <CardContent className="space-y-4 px-4">
        {statusText ??
          (status?.state === "pending" && !status.deliveryUnavailable && (
            <>
              <p className="text-sm text-muted-foreground">{m.microsoft_verify_instructions()}</p>
              {status.emailHint && <p className="text-sm font-medium">{status.emailHint}</p>}
            </>
          ))}
        <FieldError role="alert">
          {error ?? (status?.deliveryUnavailable ? m.microsoft_verify_delivery_failed() : null)}
        </FieldError>
        {notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        )}
        {actions}
      </CardContent>
    </Card>
  );
}

function VerificationPageContent({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-1 text-2xl font-bold text-brand">{APP_NAME}</div>
          <h1 className="text-lg font-semibold text-ink">{m.microsoft_verify_title()}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

function MicrosoftVerificationView(props: VerificationViewState) {
  return (
    <VerificationPageContent>
      <VerificationBody {...props} actions={<VerificationActions {...props} />} />
    </VerificationPageContent>
  );
}
