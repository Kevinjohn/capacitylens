import { useRef, useState } from "react";
import { m } from "@/i18n";
import { useAuth } from "@/auth/authContext";
import { getPlanningController, hasPlanningRuntime } from "@/data/planning/planningRuntime";
import { useStore } from "@/store/useStore";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

/** Shows safe planning recovery or an auth-off server's read-only status. */
export function PlanningStatusBanner({ placement = "banner" }: { placement?: "banner" | "modal" } = {}) {
  const { authMode } = useAuth();
  const persistError = useStore((state) => state.persistError);
  const context = useStore((state) => state.planning.context);
  const canWrite = useStore((state) => state.planning.canWrite);
  const pending = useStore((state) => state.planning.pending);
  const status = useStore((state) => state.planning.status);
  const outcome = useStore((state) => state.planning.outcome);
  const operationInFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);

  if (!persistError) {
    if (placement === "banner" && hasPlanningRuntime() && context !== null && !canWrite && authMode === "off") {
      return (
        <Alert
          variant="warn"
          className="rounded-none border-x-0 border-t-0"
          data-testid="planning-readonly-auth-banner"
        >
          <AlertDescription>{m.planning_auth_off_readonly()}</AlertDescription>
        </Alert>
      );
    }
    return null;
  }

  const hasRecoveryContext = hasPlanningRuntime() && context !== null;
  const knownCommit = hasRecoveryContext && pending?.commitment !== undefined;
  const unknownCommit =
    hasRecoveryContext && pending !== null && pending.commitment === undefined && outcome?.kind === "uncertain";
  const readFailed = hasRecoveryContext && pending === null && status === "error";

  if (!hasRecoveryContext) {
    if (placement === "modal") return null;
    return (
      <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
        <AlertDescription>{m.app_persist_error()}</AlertDescription>
      </Alert>
    );
  }

  const recover = async (operation: "reconcile" | "refresh") => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setActionFailed(false);
    try {
      const controller = getPlanningController();
      const recovered = operation === "reconcile" ? await controller.reconcile() : await controller.refresh();
      if (!recovered) setActionFailed(true);
    } catch {
      setActionFailed(true);
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const message = knownCommit
    ? m.planning_recovery_confirmed()
    : unknownCommit
      ? m.planning_recovery_unknown()
      : readFailed
        ? m.planning_recovery_read_failed()
        : m.planning_recovery_pending();
  const recoveryAction = unknownCommit ? "reconcile" : knownCommit || readFailed ? "refresh" : null;

  if (placement === "modal") {
    if (!recoveryAction) return null;
    return (
      <div className="flex flex-col gap-2 p-4" data-testid="planning-modal-recovery">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void recover(recoveryAction)}>
          {recoveryAction === "reconcile" ? m.planning_recovery_check() : m.planning_recovery_refresh()}
        </Button>
        {actionFailed && <span role="status">{m.planning_recovery_failed()}</span>}
      </div>
    );
  }

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0" data-testid="planning-status-banner">
      <AlertDescription className="flex w-full flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <span>
          {message}
          {actionFailed && <span className="block">{m.planning_recovery_failed()}</span>}
        </span>
        <span className="flex shrink-0 flex-wrap gap-2">
          {recoveryAction && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void recover(recoveryAction)}
            >
              {recoveryAction === "reconcile" ? m.planning_recovery_check() : m.planning_recovery_refresh()}
            </Button>
          )}
        </span>
      </AlertDescription>
    </Alert>
  );
}
