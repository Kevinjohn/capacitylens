import { useMemo } from "react";
import { ListFilter, Redo2, Trash2, Undo2 } from "lucide-react";
import { m } from "@/i18n";
import { redoShortcut, undoShortcut } from "../../lib/keyboardShortcuts";
import { hasActiveFilters, hasLensFilter, useStore } from "../../store/useStore";
import { useCanEdit } from "../../auth/permissionContext";
import { disciplinesEnabledFor } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { errorMessage } from "../../lib/errorMessage";
import { useSchedulerDensity } from "./layout";
import { FilterSelect } from "./FilterSelect";
import { buildFilterOptions } from "./toolbarFilterOptions";
import { useToolbarSearch } from "./useToolbarSearch";
import { ToolbarActivityFilter } from "./ToolbarActivityFilter";
import { ToolbarDateNavigation } from "./ToolbarDateNavigation";
import { SegmentedControl } from "../common/ui";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";

export function SchedulerToolbar() {
  // Viewer read-only (P1.12): a viewer has nothing to draw / mutate / undo, so the draw-mode toggle
  // and Undo/Redo are hidden. Navigation + filters (reads) stay. null/owner/admin/editor (incl.
  // OFF/local) → all affordances shown, byte-identical to today.
  const canEdit = useCanEdit();
  const compactView = useStore((s) => s.compactView);
  const density = useSchedulerDensity();
  const zoom = useStore((s) => s.ui.zoom);
  const setZoom = useStore((s) => s.setZoom);
  const panDays = useStore((s) => s.panDays);
  const goToToday = useStore((s) => s.goToToday);
  const drawMode = useStore((s) => s.ui.drawMode);
  const setDrawMode = useStore((s) => s.setDrawMode);
  // Undo/redo is global (the ⌘Z/⌘⇧Z handler lives in AppShell) but its visible affordance lives
  // here on the schedule toolbar — the main editing surface. Enabled off the history stacks.
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const setNotice = useStore((s) => s.setNotice);
  const filters = useStore((s) => s.ui.filters);
  const setFilters = useStore((s) => s.setFilters);
  const clearFilters = useStore((s) => s.clearFilters);
  const filtersActive = hasActiveFilters(filters);
  const data = useActiveScopedData();
  // These are display-only projections: keep stored order untouched while making each menu follow
  // the planning hierarchy used elsewhere in the app. Derived in ONE memo because they share a
  // single input — the (identity-stable) scoped data — and the toolbar re-renders on every
  // keystroke of the search box, where re-sorting four entity lists buys nothing.
  const { disciplineOptions, clientOptions, projectOptions, internalActivities, repeatableActivities } = useMemo(
    () => buildFilterOptions(data),
    [data],
  );

  const activeAccountId = useStore((s) => s.activeAccountId);
  // Hide the discipline filter when the account doesn't use disciplines (buildSchedulerModel
  // also ignores filters.disciplineId in that case, so a stale value can't hide anyone).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId));
  const { searchInput, onSearchChange, onClear, filtersOpen, setFiltersOpen, setToolbarFilters } = useToolbarSearch(
    filters,
    activeAccountId,
    setFilters,
    clearFilters,
  );
  const runHistoryAction = (action: () => void) => {
    try {
      action();
    } catch (error) {
      setNotice(errorMessage(error), "error");
    }
  };

  return (
    <div data-testid="scheduler-toolbar" className="@container">
      {/* flex-wrap (mirrors the filters row below): at ~320 CSS px the title + nav + date + zoom +
          draw + undo/redo would otherwise pack onto one non-wrapping line and force horizontal
          scroll, failing WCAG 1.4.10 Reflow. Wrapping lets the chrome reflow into stacked lines
          instead. Wrapping is the only thing that behaviour changes — it does not alter the
          gap/padding at any width, so wider viewports look identical. */}
      {/* Vertical density ("Compact view" device pref, default OFF = roomier). Only the Y axis moves:
          gap-x stays at 2 in both densities because this row wraps, and widening the horizontal gap
          would push it to wrap sooner — the opposite of the Reflow behaviour above. */}
      <div
        data-chrome-band="toolbar"
        className="flex flex-wrap items-center gap-x-2 border-b border-chrome-toolbar-border bg-chrome-toolbar px-4"
        style={{ paddingBlock: density.toolbarPadY, rowGap: density.toolbarGapY }}
      >
        <h1 className="mr-auto text-xl font-semibold">{m.scheduler_title()}</h1>
        <ToolbarDateNavigation zoom={zoom} onZoomChange={setZoom} onPanDays={panDays} onToday={goToToday} />
        <div data-testid="scheduler-toolbar-actions" className="ml-2 flex items-center gap-2">
          <Separator orientation="vertical" className="data-[orientation=vertical]:h-6" />
          {/* Undo/Redo: editor-only (P1.12). A viewer can't mutate, so the history affordances are
              hidden (nothing to undo). The draw-mode toggle lives with the filters below. */}
          {canEdit && (
            <>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => runHistoryAction(undo)}
                  disabled={!canUndo}
                  aria-label={m.scheduler_undo()}
                  title={m.scheduler_undo_title({ shortcut: undoShortcut() })}
                  data-testid="undo-button"
                >
                  <Undo2 />
                </Button>
                <Button
                  size="icon-sm"
                  variant="outline"
                  onClick={() => runHistoryAction(redo)}
                  disabled={!canRedo}
                  aria-label={m.scheduler_redo()}
                  title={m.scheduler_redo_title({ shortcut: redoShortcut() })}
                  data-testid="redo-button"
                >
                  <Redo2 />
                </Button>
              </div>
              <Separator orientation="vertical" className="data-[orientation=vertical]:h-6" />
            </>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="scheduler-filters"
          >
            <ListFilter data-icon="inline-start" />
            {filtersOpen ? m.scheduler_hide_filters() : m.scheduler_show_filters()}
          </Button>
        </div>
      </div>

      {filtersOpen && (
        // The filters row keeps its own Tailwind step (12px roomy) rather than `density.toolbarGapY`
        // (16px): an owner DECISION, not drift. This row wraps much sooner than the chrome above it,
        // so the roomy rhythm that suits one line of controls stacks up here.
        <div
          id="scheduler-filters"
          data-chrome-band="filterbar"
          className={`flex flex-wrap items-center justify-center gap-x-2 border-b border-chrome-filterbar-border bg-chrome-filterbar px-4 text-sm text-chrome-filterbar-ink ${compactView ? "gap-y-2 py-2" : "gap-y-3 py-3"}`}
        >
          <Input
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={m.scheduler_search_people_placeholder()}
            aria-label={m.scheduler_search_people_aria()}
            className="h-8 w-44 @max-[680px]:w-full"
          />
          {disciplinesEnabled && disciplineOptions.length > 0 && (
            <FilterSelect
              value={filters.disciplineId}
              onValueChange={(disciplineId) => setToolbarFilters({ disciplineId })}
              ariaLabel={m.scheduler_filter_discipline_aria}
              allLabel={m.scheduler_filter_all_disciplines}
              options={disciplineOptions}
            />
          )}
          <FilterSelect
            value={filters.clientId}
            onValueChange={(clientId) => setToolbarFilters({ clientId })}
            ariaLabel={m.scheduler_filter_client_aria}
            allLabel={m.scheduler_filter_all_clients}
            options={clientOptions}
          />
          <FilterSelect
            value={filters.projectId}
            onValueChange={(projectId) => setToolbarFilters({ projectId })}
            ariaLabel={m.scheduler_filter_project_aria}
            allLabel={m.scheduler_filter_all_projects}
            options={projectOptions}
          />
          {(internalActivities.length > 0 || repeatableActivities.length > 0) && (
            <ToolbarActivityFilter
              activityId={filters.activityId ?? null}
              activityKind={filters.activityKind ?? null}
              internalActivities={internalActivities}
              repeatableActivities={repeatableActivities}
              onChange={setToolbarFilters}
            />
          )}
          <SegmentedControl
            ariaLabel={m.scheduler_tentative_visibility_aria()}
            geometry="gapped"
            size="sm"
            value={filters.hideTentative ? "hide" : "show"}
            onChange={(visibility) => setToolbarFilters({ hideTentative: visibility === "hide" })}
            options={[
              { value: "show", label: m.scheduler_show_tentative() },
              { value: "hide", label: m.scheduler_hide_tentative() },
            ]}
          />
          {canEdit && (
            <SegmentedControl
              ariaLabel={m.scheduler_draw_mode_aria()}
              geometry="gapped"
              size="sm"
              value={drawMode}
              onChange={setDrawMode}
              options={[
                {
                  value: "work",
                  label: m.scheduler_draw_work(),
                  title: m.scheduler_draw_work_title(),
                },
                {
                  value: "timeoff",
                  label: m.scheduler_draw_timeoff(),
                  title: m.scheduler_draw_timeoff_title(),
                },
              ]}
            />
          )}
          {hasLensFilter(filters) && (
            <Field orientation="horizontal" className="w-auto gap-1.5" title={m.scheduler_show_unallocated_title()}>
              <Checkbox
                id="show-unmatched"
                checked={filters.showUnmatched}
                onCheckedChange={(checked) => setToolbarFilters({ showUnmatched: checked === true })}
              />
              <FieldLabel htmlFor="show-unmatched">{m.scheduler_show_unallocated()}</FieldLabel>
            </Field>
          )}
          <Button
            size="sm"
            variant={filtersActive ? "danger-soft" : "outline"}
            className="ml-auto"
            onClick={onClear}
            disabled={!filtersActive}
          >
            {filtersActive && <Trash2 aria-hidden="true" />}
            {m.scheduler_clear()}
          </Button>
        </div>
      )}
    </div>
  );
}
