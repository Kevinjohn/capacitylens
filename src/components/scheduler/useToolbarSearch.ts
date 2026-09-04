import { useEffect, useRef, useState } from "react";
import { useStore, type StoreState } from "../../store/useStore";

export function useToolbarSearch(
  filters: StoreState["ui"]["filters"],
  activeAccountId: StoreState["activeAccountId"],
  setFilters: StoreState["setFilters"],
  clearFilters: StoreState["clearFilters"],
) {
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

  return { searchInput, onSearchChange, onClear, filtersOpen, setFiltersOpen, setToolbarFilters };
}
