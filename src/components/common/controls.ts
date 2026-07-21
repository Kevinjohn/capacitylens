import type { CSSProperties } from 'react'

// Shared control STYLING, kept out of the component module (ui.tsx) so this file can
// export plain constants/objects without tripping react-refresh/only-export-components
// (which only tolerates components + primitive constant exports next to them — an
// exported style OBJECT like selectChevronStyle would otherwise fail lint). Everything
// here is framework-agnostic styling; the controls in ui.tsx and the toolbar import it.

/** Shared control styling (sans width). Used by non-label controls (toolbar
 *  search/date/selects, inline add-activity/phase inputs) so they match field height +
 *  rounding instead of drifting to their own px-2 py-1. */
export const controlBase =
  'rounded-md border bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-faint shadow-sm transition-colors'
export const inputClass = `w-full ${controlBase}`

// Native <select> draws its own chevron with browser-dependent (and on macOS, too
// tight) right padding. We suppress it (appearance-none), reserve room with pr-9, and
// paint our own chevron via background-image so it sits a consistent ~0.7rem from the
// edge. Kept off controlBase so text/date inputs that share it don't get a phantom arrow.
export const selectChevronClass = 'appearance-none pr-9'
export const selectChevronStyle: CSSProperties = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.7rem center',
  backgroundSize: '1rem',
}
