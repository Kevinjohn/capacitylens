// The "Show me around" orientation tour (driver.js). A LOOSE tour by design: five spotlight
// stops that say where things live (schedule grid, toolbar, People, Clients & projects,
// Settings) — it never navigates, never opens forms, and never waits on user actions. The
// task-by-task onboarding lives in the GettingStarted checklist instead (state-driven, so it
// can't get out of step with reality the way a scripted do-this-now tour would).
//
// Anchors: the scheduler's existing `data-testid` hooks plus the sidebar's `data-nav="<route>"`
// attribute (carried by BOTH the open-menu links and the collapsed icon rail, so the selector
// matches whichever variant is rendered). driver.js renders a step whose element is missing as a
// centred popover rather than throwing, so a hidden anchor degrades gracefully.
//
// Copy resolves through Paraglide at CALL time (startTour builds the steps on each invocation),
// so the active account's locale applies — same deferred-resolution rule as AppShell's LINKS.
// Popover colours are themed to the app tokens in `index.css` (see the `.driver-popover` block).

// driver.css is imported in main.tsx (BEFORE index.css — the override order matters; see the
// comment there), not here.
import { driver } from 'driver.js'
import { m } from '@/i18n'

/** Launch the orientation tour. Builds steps fresh (locale-correct copy) and drives from stop 1. */
export function startTour(): void {
  const tour = driver({
    showProgress: true,
    // driver.js interpolates its own `{{current}}`/`{{total}}` tokens; the surrounding words come
    // from the Paraglide message so the phrase is translatable.
    progressText: m.tour_progress({ step: '{{current}}', total: '{{total}}' }),
    nextBtnText: m.tour_next(),
    prevBtnText: m.tour_prev(),
    doneBtnText: m.tour_done(),
    // Spotlighted elements stay inert during the tour: this is a look-around, and a stray click
    // on a nav link mid-tour would navigate away underneath the overlay.
    disableActiveInteraction: true,
    steps: [
      {
        element: '[data-testid="scheduler-grid"]',
        popover: { title: m.tour_grid_title(), description: m.tour_grid_desc() },
      },
      {
        element: '[data-testid="scheduler-toolbar"]',
        popover: { title: m.tour_toolbar_title(), description: m.tour_toolbar_desc() },
      },
      // The three nav stops pin the popover to the RIGHT of the sidebar — auto placement drops
      // it below the small link, on top of the neighbouring nav rows it's pointing at.
      {
        element: '[data-nav="/resources"]',
        popover: { title: m.tour_people_title(), description: m.tour_people_desc(), side: 'right' },
      },
      {
        element: '[data-nav="/clients"]',
        popover: { title: m.tour_clients_title(), description: m.tour_clients_desc(), side: 'right' },
      },
      {
        element: '[data-nav="/settings"]',
        popover: { title: m.tour_settings_title(), description: m.tour_settings_desc(), side: 'right' },
      },
    ],
  })
  tour.drive()
}
