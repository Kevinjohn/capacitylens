import { ListFilter, Redo2, Trash2, Undo2 } from "lucide-react";
import { m } from "@/i18n";
import type { StoreState } from "../../store/useStore";
import { hasLensFilter } from "../../store/useStore";
import { buildRedoShortcut, buildUndoShortcut } from "../../lib/keyboardShortcuts";
import { SegmentedControl } from "../common/ui";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { FilterSelect } from "./FilterSelect";
import type { useSchedulerDensity } from "./layout";
import type { buildFilterOptions } from "./toolbarFilterOptions";
import { ToolbarActivityFilter } from "./ToolbarActivityFilter";
import { ToolbarDateNavigation } from "./ToolbarDateNavigation";

type Options = ReturnType<typeof buildFilterOptions>;
interface ChromeProps {
  density: ReturnType<typeof useSchedulerDensity>;
  zoom: StoreState["ui"]["zoom"];
  setZoom: StoreState["setZoom"];
  panDays: StoreState["panDays"];
  goToToday: StoreState["goToToday"];
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo: StoreState["undo"];
  redo: StoreState["redo"];
  runHistoryAction: (action: () => void) => void;
  filtersOpen: boolean;
  setFiltersOpen: (value: boolean | ((open: boolean) => boolean)) => void;
}
export interface FiltersProps extends Options {
  compactView: boolean;
  disciplinesEnabled: boolean;
  filters: StoreState["ui"]["filters"];
  filtersActive: boolean;
  canEdit: boolean;
  drawMode: StoreState["ui"]["drawMode"];
  setDrawMode: StoreState["setDrawMode"];
  searchInput: string;
  onSearchChange: (value: string) => void;
  onClear: () => void;
  setToolbarFilters: StoreState["setFilters"];
}

export function SchedulerToolbarChrome(props: ChromeProps) {
  return (
    <div
      data-chrome-band="toolbar"
      className="flex flex-wrap items-center gap-x-2 border-b border-chrome-toolbar-border bg-chrome-toolbar px-4"
      style={{ paddingBlock: props.density.toolbarPadY, rowGap: props.density.toolbarGapY }}
    >
      <h1 className="mr-auto text-xl font-semibold">{m.scheduler_title()}</h1>
      <ToolbarDateNavigation
        zoom={props.zoom}
        onZoomChange={props.setZoom}
        onPanDays={props.panDays}
        onToday={props.goToToday}
      />
      <div data-testid="scheduler-toolbar-actions" className="ml-2 flex items-center gap-2">
        <Separator orientation="vertical" className="data-[orientation=vertical]:h-6" />
        {props.canEdit && (
          <>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="outline"
                onClick={() => props.runHistoryAction(props.undo)}
                disabled={!props.canUndo}
                aria-label={m.scheduler_undo()}
                title={m.scheduler_undo_title({ shortcut: buildUndoShortcut() })}
                data-testid="undo-button"
              >
                <Undo2 />
              </Button>
              <Button
                size="icon-sm"
                variant="outline"
                onClick={() => props.runHistoryAction(props.redo)}
                disabled={!props.canRedo}
                aria-label={m.scheduler_redo()}
                title={m.scheduler_redo_title({ shortcut: buildRedoShortcut() })}
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
          onClick={() => props.setFiltersOpen((open) => !open)}
          aria-expanded={props.filtersOpen}
          aria-controls="scheduler-filters"
        >
          <ListFilter data-icon="inline-start" />
          {props.filtersOpen ? m.scheduler_hide_filters() : m.scheduler_show_filters()}
        </Button>
      </div>
    </div>
  );
}

function EntityFilters(props: FiltersProps) {
  return (
    <>
      {props.disciplinesEnabled && props.disciplineOptions.length > 0 && (
        <FilterSelect
          value={props.filters.disciplineId}
          onValueChange={(disciplineId) => props.setToolbarFilters({ disciplineId })}
          ariaLabel={m.scheduler_filter_discipline_aria}
          allLabel={m.scheduler_filter_all_disciplines}
          options={props.disciplineOptions}
        />
      )}
      <FilterSelect
        value={props.filters.clientId}
        onValueChange={(clientId) => props.setToolbarFilters({ clientId })}
        ariaLabel={m.scheduler_filter_client_aria}
        allLabel={m.scheduler_filter_all_clients}
        options={props.clientOptions}
      />
      <FilterSelect
        value={props.filters.projectId}
        onValueChange={(projectId) => props.setToolbarFilters({ projectId })}
        ariaLabel={m.scheduler_filter_project_aria}
        allLabel={m.scheduler_filter_all_projects}
        options={props.projectOptions}
      />
      {(props.internalActivities.length > 0 || props.repeatableActivities.length > 0) && (
        <ToolbarActivityFilter
          activityId={props.filters.activityId ?? null}
          activityKind={props.filters.activityKind ?? null}
          internalActivities={props.internalActivities}
          repeatableActivities={props.repeatableActivities}
          onChange={props.setToolbarFilters}
        />
      )}
    </>
  );
}

function ViewFilters(props: FiltersProps) {
  return (
    <>
      <SegmentedControl
        ariaLabel={m.scheduler_tentative_visibility_aria()}
        geometry="gapped"
        size="sm"
        value={props.filters.hideTentative ? "hide" : "show"}
        onChange={(visibility) => props.setToolbarFilters({ hideTentative: visibility === "hide" })}
        options={[
          { value: "show", label: m.scheduler_show_tentative() },
          { value: "hide", label: m.scheduler_hide_tentative() },
        ]}
      />
      {props.canEdit && (
        <SegmentedControl
          ariaLabel={m.scheduler_draw_mode_aria()}
          geometry="gapped"
          size="sm"
          value={props.drawMode}
          onChange={props.setDrawMode}
          options={[
            { value: "work", label: m.scheduler_draw_work(), title: m.scheduler_draw_work_title() },
            { value: "timeoff", label: m.scheduler_draw_timeoff(), title: m.scheduler_draw_timeoff_title() },
          ]}
        />
      )}
      {hasLensFilter(props.filters) && (
        <Field orientation="horizontal" className="w-auto gap-1.5" title={m.scheduler_show_unallocated_title()}>
          <Checkbox
            id="show-unmatched"
            checked={props.filters.showUnmatched}
            onCheckedChange={(checked) => props.setToolbarFilters({ showUnmatched: checked === true })}
          />
          <FieldLabel htmlFor="show-unmatched">{m.scheduler_show_unallocated()}</FieldLabel>
        </Field>
      )}
      <Button
        size="sm"
        variant={props.filtersActive ? "danger-soft" : "outline"}
        onClick={props.onClear}
        disabled={!props.filtersActive}
      >
        {props.filtersActive && <Trash2 aria-hidden="true" />}
        {m.scheduler_clear()}
      </Button>
    </>
  );
}

export function SchedulerToolbarFilters(props: FiltersProps) {
  return (
    <div
      id="scheduler-filters"
      data-chrome-band="filterbar"
      className={`flex flex-wrap items-center gap-x-2 border-b border-chrome-filterbar-border bg-chrome-filterbar px-4 text-sm text-chrome-filterbar-ink ${props.compactView ? "gap-y-2 py-2" : "gap-y-3 py-3"}`}
    >
      <Input
        value={props.searchInput}
        onChange={(event) => props.onSearchChange(event.target.value)}
        placeholder={m.scheduler_search_people_placeholder()}
        aria-label={m.scheduler_search_people_aria()}
        className="h-8 w-44 @max-[680px]:w-full"
      />
      <div data-testid="scheduler-filter-controls" className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <EntityFilters {...props} />
        <ViewFilters {...props} />
      </div>
    </div>
  );
}
