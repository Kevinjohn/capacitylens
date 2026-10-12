import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import type { RenderOptions } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildColumnGeometry } from "@/components/scheduler/columnGeometry";
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
} from "@/test/fixtures";

/** Provides the tooltip ancestor required by isolated bars; the full scheduler supplies its own shared provider. */
export function renderWithTooltip(ui: ReactNode, options?: Omit<RenderOptions, "wrapper">) {
  return rtlRender(ui, { wrapper: TooltipProvider, ...options });
}

/** Uniform June geometry with 48-pixel day columns and weekend minimisation disabled. */
export const GEOM = buildColumnGeometry(eachDayISO("2026-06-01", "2026-06-30"), 48, {
  minimiseWeekends: false,
  weekendWidth: 22,
});

/** Maps a pointer x-coordinate to the test grid column. */
export const indexAtClientX = (clientX: number): number => GEOM.indexAt(clientX);

/** Opens a Radix combobox by its accessible name/label and picks the option with the given name.
 * `label` accepts a RegExp for toolbar filters whose accessible name isn't a fixed string. */
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

/** Builds a minimal scoped scheduler fixture; callers may replace individual table arrays. */
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
