import * as React from "react";
import { PHONE_MAX_WIDTH_PX } from "../lib/displayPrefs";

const MOBILE_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px)`;

// One MediaQueryList shared by the snapshot read and the subscription. `getSnapshot` runs on
// every render and `window.matchMedia()` allocates a fresh list per call, so resolving it once
// keeps the hook cheap and guarantees both halves observe the same object. Resolved LAZILY —
// module scope can evaluate before a DOM exists — and re-resolved whenever `window.matchMedia`
// itself changes identity (absent in jsdom until a test installs or swaps a stub), in which case
// the query is null and the hook reports "not mobile".
let cached: { matchMedia: unknown; query: MediaQueryList | null } | null = null;

function mobileMediaQuery(): MediaQueryList | null {
  const matchMedia = typeof window.matchMedia === "function" ? window.matchMedia : null;
  if (cached === null || cached.matchMedia !== matchMedia) {
    cached = { matchMedia, query: matchMedia ? matchMedia.call(window, MOBILE_QUERY) : null };
  }
  return cached.query;
}

function getIsMobile() {
  return mobileMediaQuery()?.matches ?? false;
}

function subscribeToMobileChange(onStoreChange: () => void) {
  const mediaQuery = mobileMediaQuery();
  if (!mediaQuery) return () => {};
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribeToMobileChange, getIsMobile, () => false);
}
