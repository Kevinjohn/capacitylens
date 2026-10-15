import * as React from "react";
import { PHONE_MAX_WIDTH_PX } from "@/lib/displayPrefs";

const MOBILE_QUERY = `(max-width: ${PHONE_MAX_WIDTH_PX}px)`;

// Reuse one MediaQueryList for subscription and snapshot reads so both observe the
// same source without allocating on every render. Resolve lazily and rebuild when
// matchMedia changes; an unavailable API reports a non-mobile snapshot.
let cached: { matchMedia: unknown; query: MediaQueryList | null } | null = null;

function readMobileMediaQuery(): MediaQueryList | null {
  const matchMedia = typeof window.matchMedia === "function" ? window.matchMedia : null;
  if (cached === null || cached.matchMedia !== matchMedia) {
    cached = { matchMedia, query: matchMedia ? matchMedia.call(window, MOBILE_QUERY) : null };
  }
  return cached.query;
}

function readIsMobile() {
  return readMobileMediaQuery()?.matches ?? false;
}

function subscribeToMobileChange(onStoreChange: () => void) {
  const mediaQuery = readMobileMediaQuery();
  if (!mediaQuery) return () => {};
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

/** Subscribes to the mobile viewport media query. */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribeToMobileChange, readIsMobile, () => false);
}
