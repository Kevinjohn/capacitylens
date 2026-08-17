import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ListFilter, Redo2, Trash2, Undo2 } from "lucide-react";
import { m } from "@/i18n";
import { byName } from "../../lib/displayOrder";
import { redoShortcut, undoShortcut } from "../../lib/keyboardShortcuts";
import { hasActiveFilters, hasLensFilter, useStore } from "../../store/useStore";
import { useCanEdit } from "../../auth/permissionContext";
import { byDisciplineOrder, disciplinesEnabledFor } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { errorMessage } from "../../lib/errorMessage";
import { ZOOM_LEVELS, type WeeksZoom } from "../../lib/schedulerConfig";
import { useSchedulerDensity } from "./layout";
import { JumpToDateInput } from "./JumpToDateInput";
import { SegmentedControl } from "../common/ui";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Field, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Separator } from "../ui/separator";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/select";

/**
 * The jump-to-date picker is deliberately not rendered: reaching a far-off date is rare enough that
 * it doesn't earn toolbar space, and a month list is the likelier affordance for it. {@link
 * JumpToDateInput} stays live and tested so re-surfacing it is a one-line flip — see DECISIONS.md.
 * Typed `boolean` (not the `false` literal) so the render below is a condition, not dead code.
 */
const SHOW_JUMP_TO_DATE: boolean = false;

/** A visible span in words — "1 week" / "4 weeks". Shared by the dropdown's options and its
 *  accessible name so the two can't drift apart. */
const zoomLabel = (weeks: number) =>
  weeks > 1 ? m.scheduler_weeks_option_other({ count: weeks }) : m.scheduler_weeks_option_one({ count: weeks });

/** One entity option in a {@link FilterSelect} — the stored id and the text the menu shows. */
interface FilterOption {
  id: string;
  label: string;
}

/**
 * One "filter by <entity>" dropdown. The discipline / client / project lenses are the same control
 * three times over — a flat list with an "All …" row on top — differing only in their label, their
 * accessible name and their options, so they share this rather than repeating the Select scaffold.
 *
 * It also owns the ONE mapping the three had to get right independently: the store's `null` ("no
 * filter") against Radix's `"all"` sentinel, in both directions. The grouped activity lens is
 * deliberately NOT folded in — its encoded `kind:` values and section headers are a different
 * control that happens to look similar.
 *
 * `ariaLabel`/`allLabel` are UNCALLED message functions, invoked during render. A caller passing
 * `m.x()` instead would resolve the string once, at module scope, and never follow a locale change.
 */
function FilterSelect({
  value,
  onValueChange,
  ariaLabel,
  allLabel,
  options,
}: {
  value: string | null;
  onValueChange: (value: string | null) => void;
  ariaLabel: () => string;
  allLabel: () => string;
  options: FilterOption[];
}) {
  return (
    <Select value={value ?? "all"} onValueChange={(selected) => onValueChange(selected === "all" ? null : selected)}>
      <SelectTrigger size="sm" aria-label={ariaLabel()} className="w-auto">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">{allLabel()}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

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
  const { disciplineOptions, clientOptions, projectOptions, internalActivities, repeatableActivities } = useMemo(() => {
    const clients = [...data.clients].sort(
      (a, b) => Number(b.builtin === true) - Number(a.builtin === true) || byName(a, b),
    );
    const internalClientId = clients.find((client) => client.builtin === true)?.id;
    const clientNames = new Map(clients.map((client) => [client.id, client.name]));
    return {
      disciplineOptions: [...data.disciplines].sort(byDisciplineOrder).map((d) => ({ id: d.id, label: d.name })),
      clientOptions: clients.map((client) => ({ id: client.id, label: client.name })),
      projectOptions: [...data.projects]
        .sort(
          (a, b) => Number(b.clientId === internalClientId) - Number(a.clientId === internalClientId) || byName(a, b),
        )
        .map((project) => {
          const clientName = clientNames.get(project.clientId);
          return { id: project.id, label: clientName ? `${clientName} / ${project.name}` : project.name };
        }),
      // The activity lens covers only the project-LESS kinds — project-specific activities are
      // reached via the Projects dropdown above.
      internalActivities: data.activities.filter((t) => t.kind === "internal").sort(byName),
      repeatableActivities: data.activities.filter((t) => t.kind === "repeatable").sort(byName),
    };
  }, [data]);

  const activeAccountId = useStore((s) => s.activeAccountId);
  // Hide the discipline filter when the account doesn't use disciplines (buildSchedulerModel
  // also ignores filters.disciplineId in that case, so a stale value can't hide anyone).
  const disciplinesEnabled = useStore((s) => disciplinesEnabledFor(s.data, s.activeAccountId));
  // Debounce the search into the store: each keystroke otherwise rebuilds the whole
  // scheduler model (new filters object → model useMemo) and re-renders every lane.
  // Keep the input snappy locally; push to filters after a short pause.
  const [searchInput, setSearchInput] = useState(filters.search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Adopt external resets/replacements by reconciling during render — the React-recommended
  // alternative to a sync effect. Keyed on the filters OBJECT (identity), NOT the search
  // value: a palette project/client selection REPLACES filters with a fresh object whose
  // search is '' — if the box held a not-yet-debounced term, the search VALUE is '' on both
  // sides of that write, so a value key misses it and leaves stale text in the box. Our own
  // debounce write also makes a new object, but re-syncs to the value it just pushed
  // (a visual no-op). Track the TENANT too, so a half-typed term resets when the company
  // changes (the whole filters object can be reset on both sides of a switch).
  const [seen, setSeen] = useState({ filters, account: activeAccountId });
  if (filters !== seen.filters || activeAccountId !== seen.account) {
    setSeen({ filters, account: activeAccountId });
    setSearchInput(filters.search);
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSearchTimer = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
  };
  // Cancel any in-flight debounce when the filters object changes EXTERNALLY (Clear, a
  // palette replacement, account switch) — not just on unmount. Keyed on the OBJECT for
  // the same reason as the reconcile above: the palette race had filters.search unchanged
  // ('' → ''), so a value key left the timer alive to resurrect the stale term over the
  // palette's replacement ~180ms later. The cleanup runs before the next render's effect,
  // so an external write cancels the pending setFilters({search:'old'}) in time. (When our
  // own debounce is what changed filters, the timer has already fired — cancelling is a
  // harmless no-op.)
  useEffect(() => cancelSearchTimer, [filters, activeAccountId]);
  const onSearchChange = (v: string) => {
    setSearchInput(v);
    cancelSearchTimer();
    // The filters object the user was typing against. The effect-cleanup cancel above is
    // not enough on its own: effects flush after paint, and an external replacement (the
    // palette) triggers the expensive scheduler-model rebuild — under load the timer can
    // fire BEFORE the cleanup runs and resurrect the stale term over the replacement. So
    // the write also guards at FIRE time: if filters moved underneath the pending term,
    // it's stale — drop it.
    const armedOn = useStore.getState().ui.filters;
    searchTimer.current = setTimeout(() => {
      if (useStore.getState().ui.filters !== armedOn) return;
      setFilters({ search: v });
    }, 180);
  };
  const setToolbarFilters = (patch: Parameters<typeof setFilters>[0]) => {
    cancelSearchTimer();
    setFilters({ ...patch, search: searchInput });
  };
  // Clear must also kill any in-flight debounce + reset the local box — otherwise an
  // orphaned timer re-applies a just-cleared term (and the render reconcile can't catch
  // it when filters.search was already '').
  const onClear = () => {
    cancelSearchTimer();
    setSearchInput("");
    clearFilters();
  };
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
        {/* Prev/Next are icon-only: the chevrons carry the meaning. There is no visible text to
            contradict it, so aria-label alone names them "Prev"/"Next". */}
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => panDays(-7)}
          aria-label={m.scheduler_nav_prev()}
          title={m.scheduler_nav_prev_title()}
        >
          <ChevronLeft />
        </Button>
        <Button size="sm" variant="outline" onClick={goToToday}>
          {m.scheduler_nav_today()}
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => panDays(7)}
          aria-label={m.scheduler_nav_next()}
          title={m.scheduler_nav_next_title()}
        >
          <ChevronRight />
        </Button>
        {SHOW_JUMP_TO_DATE && <JumpToDateInput />}
        {/* Weeks visible. The trigger shows only the span ("4 weeks"), so the accessible name adds
            the purpose AND repeats that visible text — "Weeks visible, 4 weeks". A bare
            "Weeks visible" label would hide the words the user can see from speech input
            (WCAG 2.5.3 Label in Name). */}
        <Select value={String(zoom)} onValueChange={(value) => setZoom(Number(value) as WeeksZoom)}>
          <SelectTrigger
            size="sm"
            aria-label={m.scheduler_weeks_visible_aria({ span: zoomLabel(zoom) })}
            className="ml-2 w-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectGroup>
              {ZOOM_LEVELS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {zoomLabel(w)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
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
            <Select
              // Encoded value: 'all' = all, 'kind:internal'/'kind:repeatable' = a whole group,
              // otherwise a specific activity id. An activityKind selection wins over a stale activityId.
              value={filters.activityKind ? `kind:${filters.activityKind}` : (filters.activityId ?? "all")}
              onValueChange={(value) => {
                if (value === "kind:internal")
                  setToolbarFilters({
                    activityKind: "internal",
                    activityId: null,
                  });
                else if (value === "kind:repeatable")
                  setToolbarFilters({
                    activityKind: "repeatable",
                    activityId: null,
                  });
                else
                  setToolbarFilters({
                    activityId: value === "all" ? null : value,
                    activityKind: null,
                  });
              }}
            >
              <SelectTrigger size="sm" aria-label={m.scheduler_filter_activity_aria()} className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{m.scheduler_filter_all_activities()}</SelectItem>
                </SelectGroup>
                {internalActivities.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{m.scheduler_filter_internal_group()}</SelectLabel>
                    <SelectItem value="kind:internal">{m.scheduler_filter_internal_all()}</SelectItem>
                    {internalActivities.map((activity) => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {activity.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {repeatableActivities.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{m.scheduler_filter_repeatable_group()}</SelectLabel>
                    <SelectItem value="kind:repeatable">{m.scheduler_filter_repeatable_all()}</SelectItem>
                    {repeatableActivities.map((activity) => (
                      <SelectItem key={activity.id} value={activity.id}>
                        {activity.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
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
