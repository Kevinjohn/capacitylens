import { useStore } from "./useStore";
import { resolveDateStyle } from "./selectors";
import type { DateStyle } from "@capacitylens/shared/types/entities";

/**
 * The account's date format, as a value a component can depend on.
 *
 * The formatters in `src/lib/dateDisplay.ts` read the style from a module-level mirror, not from
 * React, so they produce the right string but cause no re-render on their own. That is enough for a
 * component that re-renders anyway when the account changes — but NOT for a `useMemo` that bakes a
 * formatted date into its result: nothing in its dependency array moves when only the style does,
 * so it keeps serving the old string. Those memos take this value as a dependency, and the
 * subscription it creates is also what re-renders a `memo()`'d component in the first place.
 *
 * Call it in the component that owns the memo — a dependency alone cannot wake a memoised component
 * that React never re-rendered.
 */
export function useDateStyle(): DateStyle {
  return useStore((state) => resolveDateStyle(state.data, state.activeAccountId));
}
