import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useRole } from "../auth/permissionContext";
import { useStore } from "../store/useStore";
import { useActiveScopedData } from "../store/useScopedData";
import { startTour } from "../lib/tour";
import {
  buildGettingStartedSteps,
  hasExistingSetupData,
  hasCompletedAllSteps,
  isGettingStartedComplete,
  readGettingStartedProgress,
  writeGettingStartedProgress,
} from "../lib/gettingStarted";
import { Check } from "lucide-react";
import { Button } from "./ui/button";
import { m } from "@/i18n";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";

// First-run "Getting started" checklist, rendered at the top of the schedule. State-driven, not
// scripted: each step ticks itself off by reading the ACTIVE account's scoped data (has a client /
// project / activity / person / allocation, plus the device's setup choices), so it survives the
// user wandering off mid-flow and never gets out of step with reality. The companion "Show me
// around" button runs the loose driver.js orientation tour (lib/tour.ts) — where things live, not
// do-this-now.
//
// Visibility: hidden once dismissed (device-global `capacitylens/gettingStartedDismissed` pref —
// like `introSeen`, NOT account data) OR once every step is complete (derived, per account — a
// seeded/established account never sees it). Also hidden for a Viewer: every CTA is a write
// affordance they can't complete (same rule as the list pages' hidden Add buttons).

/** One checklist row: done = check + struck-through label; not done = a Link to the page where
 *  the step happens (or plain text + hint when `to` is absent — the assign step happens right
 *  here on the schedule). */
function StepRow({
  done,
  label,
  to,
  hint,
  onClick,
}: {
  done: boolean;
  label: string;
  to?: string;
  hint?: string;
  onClick?: () => void;
}) {
  let labelContent = (
    <span className="text-ink">
      {label}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </span>
  );
  if (done) {
    labelContent = (
      <span className="text-muted-foreground line-through">
        <span className="sr-only">{m.gs_step_done_sr()}</span>
        {label}
      </span>
    );
  } else if (to) {
    labelContent = (
      <Link to={to} onClick={onClick} className="text-ink underline-offset-2 hover:text-brand hover:underline">
        {label}
      </Link>
    );
  }
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? (
        <Check className="mt-0.5 shrink-0 text-brand" />
      ) : (
        <span aria-hidden="true" className="mt-1 size-3.5 shrink-0 rounded-full border border-line" />
      )}
      {labelContent}
    </li>
  );
}

/** The first-run checklist card (see the file header for the visibility rules).
 *
 *  Split into a cheap gate + an inner component that owns the scoped-data subscription: the
 *  common case (a dismissed card, or a viewer) should read two plain booleans off the store and
 *  render null, not stay subscribed to `useActiveScopedData()` — that subscription re-runs the
 *  whole scopeData pass on every mutation for a card that already can't render anything. Only the
 *  undismissed/non-viewer case needs to know the per-step completion, so only THAT case mounts
 *  `GettingStartedCard` and pays for the subscription. */
export function GettingStarted() {
  const dismissed = useStore((state) => state.gettingStartedDismissed);
  const accountId = useStore((state) => state.activeAccountId);
  const activeRole = useRole();
  if (dismissed || activeRole === "viewer") return null;
  return <GettingStartedCard key={accountId} accountId={accountId} />;
}

/** Owns the scoped-data read + step derivation; hides itself once every step is done (a
 *  seeded/established account never sees it). Kept out of the exported gate above — see there. */
function GettingStartedCard({ accountId }: { accountId: string | null }) {
  const setDismissed = useStore((state) => state.setGettingStartedDismissed);
  const setNotice = useStore((state) => state.setNotice);
  const activeRole = useRole();
  const data = useActiveScopedData();
  const steps = buildGettingStartedSteps(data);
  const [progress, setProgress] = useState(() => {
    const saved = readGettingStartedProgress(accountId);
    return { ...saved, started: saved.started || !hasCompletedAllSteps(steps) };
  });
  useEffect(() => {
    if (accountId && progress.started) writeGettingStartedProgress(accountId, progress);
  }, [accountId, progress]);
  const { tourBusy, showTour } = useTourAction(setNotice);

  const updateProgress = (patch: Partial<typeof progress>) => {
    if (!accountId) return;
    const next = { ...progress, ...patch };
    writeGettingStartedProgress(accountId, next);
    setProgress(next);
  };

  const setupDone = progress.importChosen || progress.scratchChosen || hasExistingSetupData(steps);
  if (isGettingStartedComplete(steps, progress)) return null;

  return (
    <GettingStartedCardContent
      activeRole={activeRole}
      steps={steps}
      setupDone={setupDone}
      settingsReviewed={progress.settingsReviewed}
      startFromScratch={() => updateProgress({ scratchChosen: true })}
      chooseImport={() => updateProgress({ importChosen: true })}
      reviewSettings={() => updateProgress({ settingsReviewed: true })}
      tourBusy={tourBusy}
      showTour={showTour}
      dismiss={() => setDismissed(true)}
    />
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

function GettingStartedCardContent({
  activeRole,
  steps,
  setupDone,
  settingsReviewed,
  startFromScratch,
  chooseImport,
  reviewSettings,
  tourBusy,
  showTour,
  dismiss,
}: {
  activeRole: ReturnType<typeof useRole>;
  steps: ReturnType<typeof buildGettingStartedSteps>;
  setupDone: boolean;
  settingsReviewed: boolean;
  startFromScratch: () => void;
  chooseImport: () => void;
  reviewSettings: () => void;
  tourBusy: boolean;
  showTour: () => Promise<void>;
  dismiss: () => void;
}) {
  return (
    <Card aria-label={m.gs_title()} data-testid="getting-started" className="getting-started-popover gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{m.gs_title()}</CardTitle>
        <CardDescription className="text-xs">{m.gs_subtitle()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <GettingStartedStepsContent
          {...{ activeRole, steps, setupDone, settingsReviewed, startFromScratch, chooseImport, reviewSettings }}
        />
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
        <Button size="sm" variant="outline" onClick={dismiss} data-testid="getting-started-dismiss">
          {m.gs_dismiss()}
        </Button>
      </CardFooter>
    </Card>
  );
}

function GettingStartedStepsContent({
  activeRole,
  steps,
  setupDone,
  settingsReviewed,
  startFromScratch,
  chooseImport,
  reviewSettings,
}: Pick<
  Parameters<typeof GettingStartedCardContent>[0],
  "activeRole" | "steps" | "setupDone" | "settingsReviewed" | "startFromScratch" | "chooseImport" | "reviewSettings"
>) {
  return (
    <>
      <ol className="flex flex-col gap-1.5">
        <SetupChoiceRow
          done={setupDone}
          canImport={activeRole === null || activeRole === "owner" || activeRole === "admin"}
          chooseImport={chooseImport}
          startFromScratch={startFromScratch}
        />
        <StepRow done={steps.client} label={m.gs_step_client()} to="/clients" />
        <StepRow done={steps.project} label={m.gs_step_project()} to="/projects" />
        <StepRow done={steps.activity} label={m.gs_step_activity()} to="/activities" />
        <StepRow done={steps.person} label={m.gs_step_person()} to="/resources" />
        <StepRow done={steps.assign} label={m.gs_step_assign()} hint={m.gs_step_assign_hint()} />
        <StepRow
          done={settingsReviewed}
          label={m.gs_step_settings()}
          to="/settings#getting-started-settings"
          onClick={reviewSettings}
        />
      </ol>
      {(activeRole === "owner" || activeRole === "admin") && (
        <p className="text-sm text-ink">
          <Link to="/team" className="font-medium underline-offset-2 hover:text-brand hover:underline">
            {m.gs_invite_team()}
          </Link>{" "}
          <span className="text-xs text-muted-foreground">{m.gs_invite_team_optional()}</span>
        </p>
      )}
    </>
  );
}

function SetupChoiceRow({
  done,
  canImport,
  chooseImport,
  startFromScratch,
}: {
  done: boolean;
  canImport: boolean;
  chooseImport: () => void;
  startFromScratch: () => void;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? (
        <Check className="mt-0.5 shrink-0 text-brand" />
      ) : (
        <span aria-hidden="true" className="mt-1 size-3.5 shrink-0 rounded-full border border-line" />
      )}
      {done ? (
        <span className="text-muted-foreground line-through">
          <span className="sr-only">{m.gs_step_done_sr()}</span>
          {m.gs_step_data_choice()}
        </span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
          {canImport && (
            <>
              <Link
                to="/settings#getting-started-import"
                onClick={chooseImport}
                className="underline-offset-2 hover:text-brand hover:underline"
              >
                {m.gs_import_data()}
              </Link>
              <span className="text-muted-foreground">{m.gs_or()}</span>
            </>
          )}
          <button
            type="button"
            onClick={startFromScratch}
            className="underline-offset-2 hover:text-brand hover:underline"
          >
            {m.gs_start_scratch()}
          </button>
        </span>
      )}
    </li>
  );
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
    if (accountId && setupIncomplete && !started) {
      writeGettingStartedProgress(accountId, { started: true, importChosen, scratchChosen, settingsReviewed });
    }
  }, [accountId, importChosen, scratchChosen, settingsReviewed, setupIncomplete, started]);
  const setupDone = progress.importChosen || progress.scratchChosen || hasExistingSetupData(steps);
  if (!accountId || pathname === "/" || dismissed || role === "viewer" || isGettingStartedComplete(steps, progress))
    return null;
  const done = Object.values(steps).filter(Boolean).length + (setupDone ? 1 : 0) + (progress.settingsReviewed ? 1 : 0);
  const total = Object.keys(steps).length + 2;
  return (
    <div className="border-b border-line bg-surface px-4 py-2 text-sm" data-testid="getting-started-shortcut">
      <Link to="/" className="font-medium text-ink underline-offset-2 hover:text-brand hover:underline">
        {m.gs_return({ done, total })}
      </Link>
    </div>
  );
}
