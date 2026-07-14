import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// jsdom ships neither of these browser APIs, but cmdk (the command-palette engine) hard-depends on
// both: CommandList observes its size via ResizeObserver, and the active item is scrolled into view.
// Provide inert stubs so component tests can mount cmdk without crashing — they're observation/
// scroll niceties with no assertable behaviour in jsdom. The ResizeObserver stub is a clean no-op
// (observe/unobserve/disconnect do nothing); SchedulerGrid's `typeof ResizeObserver === 'undefined'`
// guard simply falls through to this inert observer under jsdom, which is harmless.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {} // no-op: never fires a resize callback under jsdom
    unobserve() {} // no-op
    disconnect() {} // no-op
  }
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Unmount React trees and reset jsdom between tests.
afterEach(() => {
  cleanup()
})
