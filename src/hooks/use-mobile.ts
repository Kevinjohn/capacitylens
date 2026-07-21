import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function getIsMobile() {
  return typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches
}

function subscribeToMobileChange(onStoreChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {}
  const mediaQuery = window.matchMedia(MOBILE_QUERY)
  mediaQuery.addEventListener("change", onStoreChange)
  return () => mediaQuery.removeEventListener("change", onStoreChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribeToMobileChange, getIsMobile, () => false)
}
