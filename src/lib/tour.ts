// The role tour uses the current role's segment and lower-role stops. It explains where
// permitted work happens without opening forms or asking the user to perform tasks.
//
// Anchors: the scheduler's existing `data-testid` hooks plus the sidebar's `data-nav="<route>"`
// attribute (carried by both the open-menu links and the collapsed icon rail, so the selector
// matches whichever variant is rendered). driver.js renders a step whose element is missing as a
// centred popover rather than throwing, so a hidden anchor degrades gracefully.
//
// Copy resolves through Paraglide at call time (startTour builds the steps on each invocation),
// so the active account's locale applies, same deferred-resolution rule as AppShell's LINKS.
// Popover colours are themed to the app tokens in `index.css` (see the `.driver-popover` block).

// driver.css is imported in main.tsx (before index.css, the override order matters; see the
// comment there), not here.
//
// driver.js itself (~25kB) is imported lazily below (inside startTour), not at module top level:
// this file is reachable from the eagerly-loaded GettingStarted card, so a static import would land
// the whole library in the main chunk for a click-only feature nearly nobody triggers per session.
import type { Role } from "@capacitylens/shared/domain/access";
import { m } from "@/i18n";
import { buildRoleTour } from "./tourSteps";
import type { RoleTourStepId } from "./tourSteps";

const tourCopy: Record<RoleTourStepId, { title: () => string; description: () => string }> = {
  "owner-import": { title: () => m.role_tour_owner_import_title(), description: () => m.role_tour_owner_import_desc() },
  "admin-invite": { title: () => m.role_tour_admin_invite_title(), description: () => m.role_tour_admin_invite_desc() },
  "admin-example-data": {
    title: () => m.role_tour_admin_example_data_title(),
    description: () => m.role_tour_admin_example_data_desc(),
  },
  "editor-resources": {
    title: () => m.role_tour_editor_resources_title(),
    description: () => m.role_tour_editor_resources_desc(),
  },
  "editor-hierarchy": {
    title: () => m.role_tour_editor_hierarchy_title(),
    description: () => m.role_tour_editor_hierarchy_desc(),
  },
  "editor-book": { title: () => m.role_tour_editor_book_title(), description: () => m.role_tour_editor_book_desc() },
  "viewer-grid": { title: () => m.role_tour_viewer_grid_title(), description: () => m.role_tour_viewer_grid_desc() },
  "viewer-toolbar": {
    title: () => m.role_tour_viewer_toolbar_title(),
    description: () => m.role_tour_viewer_toolbar_desc(),
  },
};

function buildDriverSteps(steps: ReturnType<typeof buildRoleTour>) {
  return steps.map((step) => {
    const copy = tourCopy[step.id];
    return {
      element: step.anchor,
      ...(step.waitForElement ? { waitForElement: step.waitForElement } : {}),
      popover: {
        title: copy.title(),
        description: copy.description(),
        ...(step.anchor.startsWith("[data-nav=") ? { side: "right" as const } : {}),
      },
    };
  });
}

/** Launch the role tour. Builds steps fresh (locale-correct copy) and drives from stop 1.
 * Async so the driver.js import can be dynamic (see the file header). Callers must `void` or
 * `await` it. */
export async function startTour({
  role,
  navigate,
  serverMode,
}: {
  role: Role | null;
  navigate: (path: string) => void;
  serverMode: boolean;
}): Promise<void> {
  if (window.location.pathname !== "/") navigate("/");
  const { driver } = await import("driver.js");
  await new Promise<void>((resolve, reject) => {
    let observer: MutationObserver | null = null;
    const finishIfDestroyed = () => {
      if (document.body.classList.contains("driver-active")) return;
      observer?.disconnect();
      resolve();
    };
    try {
      const tour = driver({
        showProgress: true,
        // driver.js interpolates its own `{{current}}`/`{{total}}` tokens; the surrounding words come
        // from the Paraglide message so the phrase is translatable.
        progressText: m.tour_progress({ step: "{{current}}", total: "{{total}}" }),
        nextBtnText: m.tour_next(),
        prevBtnText: m.tour_prev(),
        doneBtnText: m.tour_done(),
        // Spotlighted elements stay inert during the tour: this is a look-around, and a stray click
        // on a nav link mid-tour would navigate away underneath the overlay.
        disableActiveInteraction: true,
        // Defining onDestroyStarted transfers cleanup ownership to the callback in driver.js.
        onDestroyStarted: (_element, _step, { driver: activeTour }) => activeTour.destroy(),
        steps: buildDriverSteps(buildRoleTour({ role, serverMode })),
      });
      // driver.js 1.7 does not call onDestroyed when teardown lands during some transition states.
      // The body class is its authoritative lifecycle marker, so observe that actual state instead
      // of leaving the caller's busy lock dependent on an optional library callback.
      observer = new MutationObserver(finishIfDestroyed);
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      tour.drive();
      finishIfDestroyed();
    } catch (error) {
      observer?.disconnect();
      reject(error);
    }
  });
}
