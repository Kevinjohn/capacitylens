import { memo, useMemo, useState, type KeyboardEventHandler, type PointerEventHandler } from "react";
import { ensureBarColors } from "@capacitylens/shared/lib/color";
import type { ID } from "@capacitylens/shared/types/entities";
import { m } from "@/i18n";
import { useCanEdit } from "../../auth/permissionContext";
import { formatDayMonthEndpoint } from "../../lib/dateDisplay";
import { useDateStyle } from "../../store/useDateStyle";
import type { BarLabelPreferences } from "../../lib/displayPrefs";
import { resolveAllocationStatusLabel } from "../../lib/metadata";
import { useStore } from "../../store/useStore";
import { hasVisibleTaskFieldInSchedule } from "../../store/selectors";
import { AllocationBarView } from "./AllocationBarView";
import type { ColumnGeometry } from "./columnGeometry";
import { LAYOUT } from "./layout";
import type { BarLayout } from "./schedulerModel";
import { useAllocationGesture } from "./useAllocationGesture";

/** Hours/day display rounds repeating days-mode rescaling values without changing stored hours. */
const roundDisplayHours = (hours: number) => Math.round(hours * 100) / 100;

function resolveKeyboardMode(event: React.KeyboardEvent): "move" | "resize-start" | "resize-end" {
  if (event.altKey) return "resize-start";
  if (event.shiftKey) return "resize-end";
  return "move";
}

function resolveBarCursor(canEdit: boolean, dragging: boolean) {
  if (!canEdit) return "default";
  return dragging ? "grabbing" : "grab";
}

interface AllocationBarProps {
  bar: BarLayout;
  // Geometry and the lane inverse stay paired across narrowed weekend columns.
  geom: ColumnGeometry;
  indexAtClientX: (clientX: number) => number;
  // Absent for a Viewer; the gesture hook still runs so hook order remains stable across roles.
  onEdit?: (id: ID) => void;
}

interface AriaLabelInput {
  bar: BarLayout;
  canEdit: boolean;
  hideHours: boolean;
  label: string;
  showTaskFieldInSchedule: boolean;
  viewerLabel: string;
}

function buildAriaLabel({ bar, canEdit, hideHours, label, showTaskFieldInSchedule, viewerLabel }: AriaLabelInput) {
  const shared = {
    hours: hideHours ? "" : m.scheduler_bar_aria_hours({ hours: roundDisplayHours(bar.allocation.hoursPerDay) }),
    status: resolveAllocationStatusLabel(bar.allocation.status),
    start: formatDayMonthEndpoint(bar.allocation.startDate, bar.allocation.endDate),
    end: formatDayMonthEndpoint(bar.allocation.endDate, bar.allocation.startDate),
    series: bar.seriesEnd
      ? m.scheduler_bar_aria_series({ end: formatDayMonthEndpoint(bar.seriesEnd, bar.allocation.startDate) })
      : "",
  };
  const task =
    showTaskFieldInSchedule && bar.allocation.task ? m.scheduler_bar_aria_task({ task: bar.allocation.task }) : "";
  if (canEdit) {
    const note = bar.allocation.note ? m.scheduler_bar_aria_has_note() : "";
    return m.scheduler_bar_aria_editor({ ...shared, label, note, task });
  }
  const note = bar.allocation.note ? m.scheduler_bar_aria_note({ note: bar.allocation.note }) : "";
  return m.scheduler_bar_aria_viewer({ ...shared, label: viewerLabel, note, task });
}

function useBarAriaLabel(input: AriaLabelInput) {
  const { bar, canEdit, hideHours, label, showTaskFieldInSchedule, viewerLabel } = input;
  // The dates in this name are formatted INSIDE the memo, so the style has to be a dependency:
  // without it the name keeps its old format until something else invalidates the memo. Today that
  // happens by accident — changing the account rebuilds `state.data`, then the view-model, then
  // `bar` — but the accident is not the guarantee, and a bar name is what a screen-reader user
  // hears while dragging.
  const dateStyle = useDateStyle();
  // The name cannot change mid-gesture, so memoise it instead of rebuilding it on every pointermove
  // render. The date formatters read the active style from a module-level mirror rather than an
  // argument, so the linter cannot see that dependency.
  return useMemo(
    () => buildAriaLabel({ bar, canEdit, hideHours, label, showTaskFieldInSchedule, viewerLabel }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the style is a real input to the name
    [bar, canEdit, hideHours, label, showTaskFieldInSchedule, viewerLabel, dateStyle],
  );
}

function closePopoverOnEscape(event: React.KeyboardEvent, input: Parameters<typeof handleBarKeyDown>[1]) {
  if (event.key !== "Escape" || !input.popoverOpen || input.dragging) return false;
  event.preventDefault();
  event.stopPropagation();
  input.hidePopover();
  return true;
}

function activateBarFromKeyboard(event: React.KeyboardEvent, input: Parameters<typeof handleBarKeyDown>[1]) {
  if (event.key !== "Enter" && event.key !== " ") return false;
  event.preventDefault();
  input.onEdit?.(input.bar.allocation.id);
  return true;
}

function nudgeBarFromKeyboard(event: React.KeyboardEvent, input: Parameters<typeof handleBarKeyDown>[1]) {
  const isArrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
  if (!isArrow || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  input.nudge(resolveKeyboardMode(event), event.key === "ArrowRight" ? 1 : -1);
}

function handleBarPointerDown(
  event: React.PointerEvent<HTMLDivElement>,
  hidePopover: () => void,
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void,
) {
  hidePopover();
  onPointerDown(event);
}

function handleBarKeyDown(
  event: React.KeyboardEvent,
  input: {
    bar: BarLayout;
    canEdit: boolean;
    dragging: boolean;
    popoverOpen: boolean;
    hidePopover: () => void;
    nudge: (mode: "move" | "resize-start" | "resize-end", delta: number) => void;
    onEdit?: (id: ID) => void;
  },
) {
  if (event.repeat) return;
  if (closePopoverOnEscape(event, input)) return;
  if (!input.canEdit) return;
  if (activateBarFromKeyboard(event, input)) return;
  nudgeBarFromKeyboard(event, input);
}

function buildBarLabels(bar: BarLayout, preferences: BarLabelPreferences) {
  const label = [
    preferences.showClient ? bar.client : undefined,
    preferences.showProject ? bar.project : undefined,
    bar.label,
  ]
    .filter(Boolean)
    .join(" · ");
  const viewerLabel = [bar.label, [bar.project, bar.client].filter(Boolean).join(" · ")].filter(Boolean).join(", ");
  return { label, viewerLabel };
}

function useBarLabelText(bar: BarLayout) {
  return buildBarLabels(
    bar,
    useStore((state) => state.barLabelPrefs),
  );
}

function buildBarInset(left: number, width: number) {
  const inset = Math.min(LAYOUT.barInset, width / 3);
  return { insetLeft: left + inset, insetWidth: Math.max(1, width - inset * 2) };
}

/**
 * One draggable/resizable allocation bar in a resource lane.
 *
 * Gesture lifecycle: arming snapshots lane geometry and starts a scroll watcher; commit, cancel,
 * click and unmount tear those effects down. The first move pins virtualisation until teardown.
 * `onEdit` must remain stable so memoisation can skip untouched sibling bars during a drag.
 */
export const AllocationBar = memo(function AllocationBar(props: AllocationBarProps) {
  const { bar, indexAtClientX, onEdit } = props;
  const canEdit = useCanEdit();
  const gesture = useAllocationGesture({ bar, geom: props.geom, indexAtClientX, ...(onEdit ? { onEdit } : {}) });
  const hideHours = gesture.isBlocks || bar.external;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const { bg: background, ink } = useMemo(() => ensureBarColors(bar.color), [bar.color]);
  const { insetLeft, insetWidth } = buildBarInset(gesture.left, gesture.width);
  const { label: labelText, viewerLabel: viewerLabelText } = useBarLabelText(bar);
  const showTaskFieldInSchedule = useStore((state) => hasVisibleTaskFieldInSchedule(state.data, state.activeAccountId));
  const ariaLabel = useBarAriaLabel({
    bar,
    canEdit,
    hideHours,
    label: labelText,
    showTaskFieldInSchedule,
    viewerLabel: viewerLabelText,
  });
  const hidePopover = () => setPopoverOpen(false);
  const beginPointerGesture: PointerEventHandler<HTMLDivElement> | undefined = canEdit
    ? (event) => handleBarPointerDown(event, hidePopover, gesture.onPointerDown)
    : undefined;
  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) =>
    handleBarKeyDown(event, {
      bar,
      canEdit,
      dragging: gesture.dragging,
      popoverOpen,
      hidePopover,
      nudge: gesture.nudge,
      ...(onEdit ? { onEdit } : {}),
    });
  return (
    <AllocationBarView
      bar={bar}
      ariaLabel={ariaLabel}
      background={background}
      ink={ink}
      canEdit={canEdit}
      cursor={resolveBarCursor(canEdit, gesture.dragging)}
      dragging={gesture.dragging}
      hideHours={hideHours}
      insetLeft={insetLeft}
      insetWidth={insetWidth}
      labelText={labelText}
      popoverFooter={canEdit ? m.scheduler_bar_pop_footer() : m.scheduler_bar_pop_footer_viewer()}
      popoverOpen={popoverOpen}
      showSeriesIcon={bar.seriesEnd !== undefined && insetWidth >= 48}
      showTaskFieldInSchedule={showTaskFieldInSchedule}
      translateY={gesture.translateY}
      onBlur={hidePopover}
      onFocus={() => setPopoverOpen(true)}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setPopoverOpen(true)}
      onMouseLeave={hidePopover}
      onPointerDown={beginPointerGesture}
    />
  );
});
