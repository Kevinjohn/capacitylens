// Build role-aware tour stops at launch so permissions and locale are current.
// Shared navigation anchors support both sidebar states; a missing anchor degrades
// to a centered popover without opening a form.

// Load the click-only tour library lazily so it does not enlarge the eager app chunk.
// Import its CSS before app styles so theme overrides retain precedence.
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

interface TourInput {
  role: Role | null;
  navigate: (path: string) => void;
  serverMode: boolean;
}

let currentTour: Promise<void> | null = null;

/** Launch the role tour, sharing its lifecycle across launchers until it closes. */
export function startTour(input: TourInput): Promise<void> {
  currentTour ??= runTour(input).finally(() => {
    currentTour = null;
  });
  return currentTour;
}

async function runTour({ role, navigate, serverMode }: TourInput): Promise<void> {
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
      // Disconnect the observer before rejecting failed tour setup so the caller can reopen its launch control without a leaked observer.
      observer?.disconnect();
      reject(error);
    }
  });
}
