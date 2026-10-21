import { useStore } from "./useStore";
import { resolveDateStyle } from "./selectors";
import type { DateStyle } from "@capacitylens/shared/types/entities";

/** Subscribes to the company date style. Components caching formatted strings must
 * include this value in memo dependencies; the synchronous formatter mirror alone
 * cannot trigger a render.
 */
export function useDateStyle(): DateStyle {
  return useStore((state) => resolveDateStyle(state.data, state.activeAccountId));
}
