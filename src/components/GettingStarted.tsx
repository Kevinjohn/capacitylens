import { Link } from 'react-router-dom'
import { useRole } from '../auth/permissionContext'
import { useStore } from '../store/useStore'
import { useActiveScopedData } from '../store/useScopedData'
import { startTour } from '../lib/tour'
import { deriveGettingStartedSteps, allStepsDone } from '../lib/gettingStarted'
import { Check } from 'lucide-react'
import { Button } from './ui/button'
import { m } from '@/i18n'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'

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
        <Check className="mt-0.5 shrink-0 text-brand" />
      ) : (
        <span aria-hidden="true" className="mt-1 size-3.5 shrink-0 rounded-full border border-line" />
      )}
      {done ? (
        <span className="text-muted-foreground line-through">
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
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
      )}
    </li>
  )
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
  const dismissed = useStore((s) => s.gettingStartedDismissed)
  const activeRole = useRole()
  if (dismissed || activeRole === 'viewer') return null
  return <GettingStartedCard />
}

/** Owns the scoped-data read + step derivation; hides itself once every step is done (a
 *  seeded/established account never sees it). Kept out of the exported gate above — see there. */
function GettingStartedCard() {
  const setDismissed = useStore((s) => s.setGettingStartedDismissed)
  const activeRole = useRole()
  const data = useActiveScopedData()
  const steps = deriveGettingStartedSteps(data)

  if (allStepsDone(steps)) return null

  return (
    <Card
      aria-label={m.gs_title()}
      data-testid="getting-started"
      className="getting-started-popover gap-4 py-4"
    >
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{m.gs_title()}</CardTitle>
        <CardDescription className="text-xs">{m.gs_subtitle()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4">
        <ol className="flex flex-col gap-1.5">
          <StepRow done={steps.client} label={m.gs_step_client()} to="/clients" />
          <StepRow done={steps.project} label={m.gs_step_project()} to="/projects" />
          <StepRow done={steps.person} label={m.gs_step_person()} to="/resources" />
          <StepRow done={steps.assign} label={m.gs_step_assign()} hint={m.gs_step_assign_hint()} />
        </ol>
        {(activeRole === 'owner' || activeRole === 'admin') && (
          <p className="text-sm text-ink">
            <Link to="/team" className="font-medium underline-offset-2 hover:text-brand hover:underline">
              {m.gs_invite_team()}
            </Link>{' '}
            <span className="text-xs text-muted-foreground">{m.gs_invite_team_optional()}</span>
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2 px-4">
        <Button size="sm" onClick={() => void startTour()} data-testid="getting-started-tour">
          {m.gs_show_me_around()}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setDismissed(true)} data-testid="getting-started-dismiss">
          {m.gs_dismiss()}
        </Button>
      </CardFooter>
    </Card>
  )
}
