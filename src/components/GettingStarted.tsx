import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import { useRole } from "../auth/permissionContext";
import { isDemoMode } from "../data/apiConfig";
import { gettingStartedClient } from "../account/gettingStartedClient";
import { buildGettingStartedSteps } from "../lib/gettingStarted";
import { startTour } from "../lib/tour";
import { useActiveScopedData } from "../store/useScopedData";
import { useStore } from "../store/useStore";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { m } from "@/i18n";

function StepRow({ done, label, to }: { done: boolean; label: string; to: string }) {
  const labelContent = done ? (
    <span className="text-muted-foreground line-through">
      <span className="sr-only">{m.gs_step_done_sr()}</span>
      {label}
    </span>
  ) : (
    <Link to={to} className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline">
      {label}
    </Link>
  );
  return (
    <li className="flex items-center gap-2 text-sm">
      {done ? (
        <Check className="mt-0.5 size-4 shrink-0 text-brand" />
      ) : (
        <span aria-hidden="true" className="mt-1 size-3.5 shrink-0 rounded-full border border-line" />
      )}
      <div className="min-w-0">{labelContent}</div>
    </li>
  );
}

const demoDismissedAccounts = new Set<string>();

export function GettingStarted() {
  const accountId = useStore((state) => state.activeAccountId);
  if (!accountId) return null;
  return <GettingStartedForAccount key={accountId} accountId={accountId} />;
}

function shouldOpenChecklistByDefault(pathname: string, done: number): boolean {
  return pathname === "/" && done < 5;
}

function GettingStartedForAccount({ accountId }: { accountId: string }) {
  const setNotice = useStore((state) => state.setNotice);
  const activeRole = useRole();
  const { pathname } = useLocation();
  const data = useActiveScopedData();
  const steps = buildGettingStartedSteps(data);
  const done = Object.values(steps).filter(Boolean).length;
  const [openChoice, setOpenChoice] = useState<{ path: string; open: boolean } | null>(null);
  const open = openChoice?.path === pathname ? openChoice.open : shouldOpenChecklistByDefault(pathname, done);
  const setOpen = (value: boolean) => setOpenChoice({ path: pathname, open: value });
  const showButton = useRef<HTMLButtonElement>(null);
  const { tourBusy, showTour } = useTourAction(setNotice);
  const { dismissed, loaded, loadFailed, retryLoad, confirmOpen, setConfirmOpen, saving, dismiss } =
    useCompanyDismissal(accountId, pathname, setNotice);
  const requestDismiss = () => {
    if (done < 5) setConfirmOpen(true);
    else void dismiss();
  };
  if (!loaded || dismissed || activeRole === "viewer") return null;
  const canDismiss = activeRole === "owner" || activeRole === "admin" || activeRole === null;

  return (
    <div className="relative border-b border-line bg-surface" data-testid="getting-started-progress">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
        <span className="font-medium text-ink">{m.gs_title()}</span>
        <span className="text-muted-foreground">{done}/5</span>
        <div
          role="progressbar"
          aria-label={m.gs_title()}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-valuenow={done}
          className="h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-muted sm:max-w-48"
        >
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${done * 20}%` }} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {loadFailed && (
            <Button size="sm" variant="outline" onClick={retryLoad}>
              {m.gs_retry()}
            </Button>
          )}
          <Button ref={showButton} size="sm" variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? m.gs_hide_card() : m.gs_show_card()}
          </Button>
          {canDismiss && (
            <Button size="sm" variant="ghost" onClick={requestDismiss} data-testid="getting-started-dismiss">
              {m.gs_dismiss()}
            </Button>
          )}
        </div>
      </div>
      {open && (
        <GettingStartedCard
          steps={steps}
          tourBusy={tourBusy}
          showTour={showTour}
          canDismiss={canDismiss}
          requestDismiss={requestDismiss}
          hide={() => {
            setOpen(false);
            showButton.current?.focus();
          }}
        />
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{m.gs_confirm_dismiss()}</AlertDialogTitle>
            <AlertDialogDescription>{m.gs_confirm_dismiss_detail()}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{m.gs_no()}</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void dismiss();
              }}
            >
              {m.gs_yes()}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GettingStartedCard({
  steps,
  tourBusy,
  showTour,
  canDismiss,
  requestDismiss,
  hide,
}: {
  steps: ReturnType<typeof buildGettingStartedSteps>;
  tourBusy: boolean;
  showTour: () => Promise<void>;
  canDismiss: boolean;
  requestDismiss: () => void;
  hide: () => void;
}) {
  return (
    <Card aria-label={m.gs_title()} data-testid="getting-started" className="getting-started-popover gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{m.gs_title()}</CardTitle>
        <CardDescription className="text-xs">{m.gs_subtitle()}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <FirstUseMilestones steps={steps} />
      </CardContent>
      <CardFooter className="gap-2 px-4">
        <Button
          size="sm"
          onClick={() => void showTour()}
          data-testid="getting-started-tour"
          disabled={tourBusy}
          aria-busy={tourBusy || undefined}
        >
          {m.gs_show_me_around()}
        </Button>
        <Button size="sm" variant="outline" onClick={hide}>
          {m.gs_hide_card()}
        </Button>
        {canDismiss && (
          <Button size="sm" variant="ghost" onClick={requestDismiss}>
            {m.gs_dismiss()}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function FirstUseMilestones({ steps }: { steps: ReturnType<typeof buildGettingStartedSteps> }) {
  return (
    <ol className="flex flex-col gap-2">
      <StepRow done={steps.person} label={m.gs_step_person()} to="/resources" />
      <StepRow done={steps.client} label={m.gs_add_client()} to="/clients" />
      <StepRow done={steps.project} label={m.gs_add_project_to_client()} to="/projects" />
      <StepRow done={steps.activity} label={m.gs_step_activity()} to="/activities" />
      <StepRow done={steps.scheduled} label={m.gs_step_schedule()} to="/" />
    </ol>
  );
}

function useCompanyDismissal(accountId: string, pathname: string, setNotice: (message: string, tone: "error") => void) {
  const [dismissed, setDismissed] = useState(() => isDemoMode() && demoDismissedAccounts.has(accountId));
  const [loaded, setLoaded] = useState(() => isDemoMode());
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const dismissedRef = useRef(dismissed);
  useEffect(() => {
    if (isDemoMode() || dismissedRef.current) return;
    const controller = new AbortController();
    void gettingStartedClient
      .read(accountId, controller.signal)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Getting started read failed (${response.status})`);
        const result = (await response.json()) as { dismissed: boolean };
        if (!controller.signal.aborted && !dismissedRef.current) {
          setDismissed(result.dismissed);
          dismissedRef.current = result.dismissed;
          setLoadFailed(false);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (controller.signal.aborted || dismissedRef.current) return;
        console.error("GettingStarted: company state could not be loaded");
        setLoadFailed(true);
        setLoaded(true);
        setNotice(m.gs_load_failed(), "error");
      });
    return () => controller.abort();
  }, [accountId, pathname, loadAttempt, setNotice]);

  const dismiss = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (!isDemoMode()) {
        const response = await gettingStartedClient.dismiss(accountId);
        if (!response.ok) throw new Error(`Getting started dismissal failed (${response.status})`);
      }
      if (isDemoMode()) demoDismissedAccounts.add(accountId);
      dismissedRef.current = true;
      setDismissed(true);
      setConfirmOpen(false);
    } catch {
      console.error("GettingStarted: dismissal could not be saved");
      setNotice(m.gs_dismiss_failed(), "error");
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };
  return {
    dismissed,
    loaded,
    loadFailed,
    retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
    confirmOpen,
    setConfirmOpen,
    saving,
    dismiss,
  };
}

function useTourAction(setNotice: (message: string, tone: "error") => void) {
  const tourInFlight = useRef(false);
  const [tourBusy, setTourBusy] = useState(false);
  const showTour = async (): Promise<void> => {
    if (tourInFlight.current) return;
    tourInFlight.current = true;
    setTourBusy(true);
    try {
      await startTour();
    } catch {
      console.error("GettingStarted: tour failed to start");
      setNotice(m.gs_tour_failed(), "error");
    } finally {
      tourInFlight.current = false;
      setTourBusy(false);
    }
  };
  return { tourBusy, showTour };
}
