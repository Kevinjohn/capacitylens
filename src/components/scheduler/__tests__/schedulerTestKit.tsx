import { render as rtlRender, screen, fireEvent, type RenderOptions } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { TooltipProvider } from "../../ui/tooltip";
import { buildColumnGeometry } from "../columnGeometry";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import type { AppData } from "@capacitylens/shared/types/entities";
import {
  DEFAULT_ACCOUNT_ID,
  makeActivity,
  makeAllocation,
  makeAppData,
  makeClient,
  makeProject,
  makeResource,
} from "../../../test/fixtures";

// Shared setup shared by ≥3 scheduler test files. Centralises the provider-less-TooltipRoot render
// wrapper, the standard June column geometry, the combobox-option chooser used by every modal/toolbar
// filter test, and a minimal one-resource/one-allocation dataset builder. Extend here rather than
// re-hand-rolling any of these in a new scheduler test file.

/** AllocationBar/ResourceLane now render a provider-less TooltipRoot (the single TooltipProvider is
 *  hoisted to SchedulerGrid in the real app), so isolated renders must supply their own provider. */
export function renderWithTooltip(ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) {
  return rtlRender(ui, { wrapper: TooltipProvider, ...options });
}

/** Uniform geometry over June at 48px/day (minimise off), origin 2026-06-01 — the standard
 *  standalone-bar geometry: no drag crosses columns, so the resolver only needs to exist for the
 *  prop contract. */
export const GEOM = buildColumnGeometry(eachDayISO("2026-06-01", "2026-06-30"), 48, {
  minimiseWeekends: false,
  weekendWidth: 22,
});

export const indexAtClientX = (clientX: number): number => GEOM.indexAt(clientX);

/** Opens a Radix combobox by its accessible name/label and picks the option with the given name.
 *  `label` accepts a RegExp for toolbar filters whose accessible name isn't a fixed string. */
export async function chooseOption(
  _user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp,
  optionName: string,
): Promise<void> {
  const trigger = screen.getByRole("combobox", { name: label });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

/** A minimal scheduler dataset: one discipline ("Design"), one person ("Bruce") in it, one client
 *  ("Acme"), one project ("Lightning"), one activity ("Wireframes") and one confirmed allocation —
 *  all filed under {@link DEFAULT_ACCOUNT_ID}. Override any AppData slice per test (e.g. add an
 *  external resource, or replace `allocations`). */
export function schedulerDataset(overrides: Partial<AppData> = {}): AppData {
  const ACC = DEFAULT_ACCOUNT_ID;
  return makeAppData({
    disciplines: [{ id: "d1", accountId: ACC, createdAt: "t", updatedAt: "t", name: "Design", sortOrder: 0 }],
    resources: [makeResource({ accountId: ACC, disciplineId: "d1", name: "Bruce", color: "#111" })],
    clients: [makeClient({ accountId: ACC })],
    projects: [makeProject({ accountId: ACC })],
    phases: [],
    activities: [makeActivity({ accountId: ACC })],
    allocations: [makeAllocation({ accountId: ACC })],
    timeOff: [],
    ...overrides,
  });
}
