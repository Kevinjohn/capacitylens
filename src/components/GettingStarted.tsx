import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import { useRole } from "../auth/permissionContext";
import {
  buildGettingStartedSteps,
  hasCompletedAllSteps,
  hasExistingSetupData,
  isGettingStartedComplete,
  readGettingStartedProgress,
  writeGettingStartedProgress,
} from "../lib/gettingStarted";
import { startTour } from "../lib/tour";
import { useActiveScopedData } from "../store/useScopedData";
import { useStore } from "../store/useStore";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { m } from "@/i18n";

function StepRow({
  done,
  label,
  to,
  help,
  children,
  focusRef,
}: {
  done: boolean;
  label: string;
  to?: string;
  help: string;
  children?: React.ReactNode;
  focusRef?: React.Ref<HTMLDivElement> | undefined;
}) {
  let labelContent = <span className="font-medium text-ink">{label}</span>;
  if (done) {
    labelContent = (
      <span className="text-muted-foreground line-through">
        <span className="sr-only">{m.gs_step_done_sr()}</span>
        {label}
      </span>
    );
  } else if (to) {
    labelContent = (
      <Link to={to} className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline">
        {label}
      </Link>
    );
  }
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? (
        <Check className="mt-0.5 size-4 shrink-0 text-brand" />
      ) : (
        <span aria-hidden="true" className="mt-1 size-3.5 shrink-0 rounded-full border border-line" />
      )}
      <div
        ref={focusRef}
        className="min-w-0"
        {...(focusRef ? { tabIndex: -1, "aria-label": label, "data-testid": "first-incomplete-milestone" } : {})}
      >
        {labelContent}
        {!done && <p className="text-xs text-muted-foreground">{help}</p>}
        {!done && children}
      </div>
    </li>
  );
}

export function GettingStarted() {
  const dismissed = useStore((state) => state.gettingStartedDismissed);
  const accountId = useStore((state) => state.activeAccountId);
  const activeRole = useRole();
  if (dismissed || activeRole === "viewer") return null;
  return <GettingStartedCard key={accountId} accountId={accountId} />;
}

function GettingStartedCard({ accountId }: { accountId: string | null }) {
  const setDismissed = useStore((state) => state.setGettingStartedDismissed);
  const setNotice = useStore((state) => state.setNotice);
  const activeRole = useRole();
  const data = useActiveScopedData();
  const steps = buildGettingStartedSteps(data);
  const [progress, setProgress] = useState(() => readGettingStartedProgress(accountId));
  useEffect(() => {
    if (accountId && progress.started) writeGettingStartedProgress(accountId, progress);
  }, [accountId, progress]);
  const { tourBusy, showTour } = useTourAction(setNotice);

  const choosePath = (patch: Partial<typeof progress>) => {
    if (!accountId) return;
    const next = { ...progress, ...patch };
    writeGettingStartedProgress(accountId, next);
    setProgress(next);
  };

  const showMilestones =
    progress.started || progress.importChosen || progress.scratchChosen || hasExistingSetupData(data, steps);
  const canImport = activeRole === null || activeRole === "owner";
  const { milestoneFocusRef, requestMilestoneFocus } = useManualMilestoneFocus(showMilestones);
  const chooseManual = () => {
    requestMilestoneFocus();
    choosePath({ scratchChosen: true });
  };
  if (isGettingStartedComplete(steps, progress)) return null;

  return (
    <Card aria-label={m.gs_title()} data-testid="getting-started" className="getting-started-popover gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{m.gs_title()}</CardTitle>
        <CardDescription className="text-xs">{m.gs_subtitle()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        {showMilestones ? (
          <>
            <FirstUseMilestones steps={steps} focusRef={milestoneFocusRef} />
            <SupportingActions
              activeRole={activeRole}
              {...(canImport ? { importAction: () => choosePath({ importChosen: true }) } : {})}
            />
          </>
        ) : (
          <>
            <SetupChoices
              canImport={canImport}
              onImport={() => choosePath({ importChosen: true })}
              onManual={chooseManual}
            />
            <SupportingActions activeRole={activeRole} />
          </>
        )}
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
        <Button size="sm" variant="outline" onClick={() => setDismissed(true)} data-testid="getting-started-dismiss">
          {m.gs_dismiss()}
        </Button>
      </CardFooter>
    </Card>
  );
}

function useManualMilestoneFocus(showMilestones: boolean) {
  const focusAfterManual = useRef(false);
  const milestoneFocusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMilestones || !focusAfterManual.current) return;
    focusAfterManual.current = false;
    milestoneFocusRef.current?.focus();
  }, [showMilestones]);
  return { milestoneFocusRef, requestMilestoneFocus: () => (focusAfterManual.current = true) };
}

function firstIncompleteOutcome(steps: ReturnType<typeof buildGettingStartedSteps>) {
  if (!steps.person) return "person";
  if (!steps.work) return "work";
  return "scheduled";
}

function FirstUseMilestones({
  steps,
  focusRef,
}: {
  steps: ReturnType<typeof buildGettingStartedSteps>;
  focusRef: React.RefObject<HTMLDivElement | null>;
}) {
  const firstIncomplete = firstIncompleteOutcome(steps);
  return (
    <ol className="flex flex-col gap-3">
      <StepRow
        done={steps.person}
        label={m.gs_step_person()}
        to="/resources"
        help={m.gs_step_person_help()}
        {...(firstIncomplete === "person" ? { focusRef } : {})}
      />
      <StepRow
        done={steps.work}
        label={m.gs_step_work()}
        to="/activities"
        help={m.gs_step_work_help()}
        {...(firstIncomplete === "work" ? { focusRef } : {})}
      >
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <Link to="/clients" className="underline-offset-2 hover:text-brand hover:underline">
            {m.gs_add_client()}
          </Link>
          <Link to="/projects" className="underline-offset-2 hover:text-brand hover:underline">
            {m.gs_add_project()}
          </Link>
        </span>
      </StepRow>
      <StepRow
        done={steps.scheduled}
        label={m.gs_step_schedule()}
        help={m.gs_step_schedule_help()}
        {...(firstIncomplete === "scheduled" ? { focusRef } : {})}
      />
    </ol>
  );
}

function SetupChoices({
  canImport,
  onImport,
  onManual,
}: {
  canImport: boolean;
  onImport: () => void;
  onManual: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {canImport && (
        <div>
          <Link
            to="/settings#getting-started-import"
            onClick={onImport}
            className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
          >
            {m.gs_import_data()}
          </Link>
          <p className="text-xs text-muted-foreground">{m.gs_import_help()}</p>
        </div>
      )}
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={onManual}>
        {m.gs_start_manual()}
      </Button>
    </div>
  );
}

function SupportingActions({
  activeRole,
  importAction,
}: {
  activeRole: ReturnType<typeof useRole>;
  importAction?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
      {importAction && (
        <div>
          <Link
            to="/settings#getting-started-import"
            onClick={importAction}
            className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
          >
            {m.gs_import_data()}
          </Link>
          <p className="text-xs text-muted-foreground">{m.gs_import_help()}</p>
        </div>
      )}
      <Link
        to="/settings#getting-started-settings"
        className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline"
      >
        {m.gs_adjust_settings()}
      </Link>
      {(activeRole === "owner" || activeRole === "admin") && (
        <div>
          <Link to="/team" className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline">
            {m.gs_invite_team()}
          </Link>
          <p className="text-xs text-muted-foreground">{m.gs_invite_team_help()}</p>
        </div>
      )}
    </div>
  );
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
    } catch (error) {
      console.error("GettingStarted: tour failed to start", error);
      setNotice(m.gs_tour_failed(), "error");
    } finally {
      tourInFlight.current = false;
      setTourBusy(false);
    }
  };
  return { tourBusy, showTour };
}

export function GettingStartedShortcut() {
  const { pathname } = useLocation();
  const dismissed = useStore((state) => state.gettingStartedDismissed);
  const accountId = useStore((state) => state.activeAccountId);
  const role = useRole();
  const data = useActiveScopedData();
  const steps = buildGettingStartedSteps(data);
  const progress = readGettingStartedProgress(accountId);
  const setupIncomplete = !hasCompletedAllSteps(steps);
  const { started, importChosen, scratchChosen, settingsReviewed } = progress;
  useEffect(() => {
    if (accountId && setupIncomplete && !started)
      writeGettingStartedProgress(accountId, { started: true, importChosen, scratchChosen, settingsReviewed });
  }, [accountId, importChosen, scratchChosen, settingsReviewed, setupIncomplete, started]);
  if (!accountId || pathname === "/" || dismissed || role === "viewer" || isGettingStartedComplete(steps, progress))
    return null;
  const done = Object.values(steps).filter(Boolean).length;
  return (
    <div className="border-b border-line bg-surface px-4 py-2 text-sm" data-testid="getting-started-shortcut">
      <Link to="/" className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline">
        {m.gs_return({ done, total: Object.keys(steps).length })}
      </Link>
    </div>
  );
}
