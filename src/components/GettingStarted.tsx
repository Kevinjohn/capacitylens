import { Link } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { useActiveScopedData } from '../store/useScopedData'
import { startTour } from '../lib/tour'
import { deriveGettingStartedSteps } from '../lib/gettingStarted'
import { Button } from './common/ui'
import { Icon } from './common/Icon'
import { m } from '@/i18n'

// First-run "Getting started" checklist, rendered at the top of the schedule. State-driven, not
// scripted: each step ticks itself off by reading the ACTIVE account's scoped data (has a client /
// project / person / allocation), so it survives the user wandering off mid-flow and never gets out
// of step with reality. The companion "Show me around" button runs the loose driver.js orientation
// tour (lib/tour.ts) — where things live, not do-this-now.
//
// Visibility: hidden once dismissed (device-global `capacitylens/gettingStartedDismissed` pref —
// like `introSeen`, NOT account data) OR once every step is complete (derived, per account — a
// seeded/established account never sees it). Also hidden for a Viewer: every CTA is a write
// affordance they can't complete (same rule as the list pages' hidden Add buttons).

/** One checklist row: done = check + struck-through label; not done = a Link to the page where
 *  the step happens (or plain text + hint when `to` is absent — the assign step happens right
 *  here on the schedule). */
function StepRow({ done, label, to, hint }: { done: boolean; label: string; to?: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {done ? (
        <Icon name="check" className="mt-0.5 shrink-0 text-brand" />
      ) : (
        <span aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border border-line" />
      )}
      {done ? (
        <span className="text-muted line-through">
          <span className="sr-only">{m.gs_step_done_sr()}</span>
          {label}
        </span>
      ) : to ? (
        <Link to={to} className="text-ink underline-offset-2 hover:text-brand hover:underline">
          {label}
        </Link>
      ) : (
        <span className="text-ink">
          {label}
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      )}
    </li>
  )
}

/** The first-run checklist card (see the file header for the visibility rules). */
export function GettingStarted() {
  const dismissed = useStore((s) => s.gettingStartedDismissed)
  const setDismissed = useStore((s) => s.setGettingStartedDismissed)
  const activeRole = useStore((s) => s.activeRole)
  const data = useActiveScopedData()
  const steps = deriveGettingStartedSteps(data)

  const allDone = steps.client && steps.project && steps.person && steps.assign
  if (dismissed || allDone || activeRole === 'viewer') return null

  return (
    <section
      aria-label={m.gs_title()}
      data-testid="getting-started"
      className="m-3 mb-0 max-w-xl rounded-lg border border-line bg-surface p-4 shadow-sm"
    >
      <h2 className="text-sm font-semibold text-ink">{m.gs_title()}</h2>
      <p className="mb-3 mt-0.5 text-xs text-muted">{m.gs_subtitle()}</p>
      <ol className="space-y-1.5">
        <StepRow done={steps.client} label={m.gs_step_client()} to="/clients" />
        <StepRow done={steps.project} label={m.gs_step_project()} to="/projects" />
        <StepRow done={steps.person} label={m.gs_step_person()} to="/resources" />
        <StepRow done={steps.assign} label={m.gs_step_assign()} hint={m.gs_step_assign_hint()} />
      </ol>
      <div className="mt-4 flex items-center gap-2">
        <Button onClick={startTour} testId="getting-started-tour">
          {m.gs_show_me_around()}
        </Button>
        <Button variant="ghost" onClick={() => setDismissed(true)} testId="getting-started-dismiss">
          {m.gs_dismiss()}
        </Button>
      </div>
    </section>
  )
}
