import { useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import type { StoreState } from "@/store/useStore";

interface UseToolbarSearchInput {
  filters: StoreState["ui"]["filters"];
  activeAccountId: StoreState["activeAccountId"];
  setFilters: StoreState["setFilters"];
  clearFilters: StoreState["clearFilters"];
}

/** Debounces schedule search and cancels stale text after external filter changes. */
export function useToolbarSearch({ filters, activeAccountId, setFilters, clearFilters }: UseToolbarSearchInput) {
  // Debounce the search into the store: each keystroke otherwise rebuilds the whole
  // scheduler model (new filters object → model useMemo) and re-renders every lane.
  // Keep the input snappy locally; push to filters after a short pause.
  const [searchInput, setSearchInput] = useState(filters.search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Reconcile pending text on filter-object or tenant changes, because an external replacement may keep the committed search string unchanged.
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
  // Cancel pending search when its owning filter object is replaced so an old timer cannot overwrite a newer filter choice.
  useEffect(() => cancelSearchTimer, [filters, activeAccountId]);
  const changeSearch = (value: string) => {
    setSearchInput(value);
    cancelSearchTimer();
    // Recheck filter ownership when the timer fires because effect cleanup may run after the replacement render, allowing a stale timer to execute first.
    const armedOn = useStore.getState().ui.filters;
    searchTimer.current = setTimeout(() => {
      if (useStore.getState().ui.filters !== armedOn) return;
      setFilters({ search: value });
    }, 180);
  };
  const setToolbarFilters = (patch: Parameters<typeof setFilters>[0]) => {
    cancelSearchTimer();
    setFilters({ ...patch, search: searchInput });
  };
  // Clear must cancel its pending timer as well as reset local text so stale input cannot return after the debounce.
  const clearSearch = () => {
    cancelSearchTimer();
    setSearchInput("");
    clearFilters();
  };

  return {
    searchInput,
    onSearchChange: changeSearch,
    onClear: clearSearch,
    filtersOpen,
    setFiltersOpen,
    setToolbarFilters,
  };
}
