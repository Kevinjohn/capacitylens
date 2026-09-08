import { useMemo } from "react";
import { useCanEdit } from "../../auth/permissionContext";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { hasActiveFilters, useStore } from "../../store/useStore";
import { hasDisciplinesEnabled } from "../../store/selectors";
import { useActiveScopedData } from "../../store/useScopedData";
import { useSchedulerDensity } from "./layout";
import { SchedulerToolbarChrome, SchedulerToolbarFilters } from "./SchedulerToolbarSections";
import { buildFilterOptions } from "./toolbarFilterOptions";
import { useToolbarSearch } from "./useToolbarSearch";

function useToolbarHistory() {
  const undo = useStore((state) => state.undo);
  const redo = useStore((state) => state.redo);
  const canUndo = useStore((state) => state.past.length > 0);
  const canRedo = useStore((state) => state.future.length > 0);
  const setNotice = useStore((state) => state.setNotice);
  const runHistoryAction = (action: () => void) => {
    try {
      action();
    } catch (error) {
      setNotice(resolveErrorMessage(error), "error");
    }
  };
  return { undo, redo, canUndo, canRedo, runHistoryAction };
}

export function SchedulerToolbar() {
  const canEdit = useCanEdit();
  const compactView = useStore((state) => state.compactView);
  const density = useSchedulerDensity();
  const zoom = useStore((state) => state.ui.zoom);
  const setZoom = useStore((state) => state.setZoom);
  const panDays = useStore((state) => state.panDays);
  const goToToday = useStore((state) => state.goToToday);
  const drawMode = useStore((state) => state.ui.drawMode);
  const setDrawMode = useStore((state) => state.setDrawMode);
  const history = useToolbarHistory();
  const filters = useStore((state) => state.ui.filters);
  const setFilters = useStore((state) => state.setFilters);
  const clearFilters = useStore((state) => state.clearFilters);
  const filtersActive = hasActiveFilters(filters);
  const data = useActiveScopedData();
  const options = useMemo(() => buildFilterOptions(data), [data]);
  const activeAccountId = useStore((state) => state.activeAccountId);
  const disciplinesEnabled = useStore((state) => hasDisciplinesEnabled(state.data, state.activeAccountId));
  const search = useToolbarSearch({ filters, activeAccountId, setFilters, clearFilters });
  const chromeProps = {
    density,
    zoom,
    setZoom,
    panDays,
    goToToday,
    canEdit,
    ...history,
    filtersOpen: search.filtersOpen,
    setFiltersOpen: search.setFiltersOpen,
  };
  const filterProps = {
    ...options,
    compactView,
    disciplinesEnabled,
    filters,
    filtersActive,
    canEdit,
    drawMode,
    setDrawMode,
    searchInput: search.searchInput,
    onSearchChange: search.onSearchChange,
    onClear: search.onClear,
    setToolbarFilters: search.setToolbarFilters,
  };
  return (
    <div data-testid="scheduler-toolbar" className="@container">
      <SchedulerToolbarChrome {...chromeProps} />
      {search.filtersOpen && <SchedulerToolbarFilters {...filterProps} />}
    </div>
  );
}
