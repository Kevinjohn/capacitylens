import { vi } from "vitest";

/** Replace `window.matchMedia` with a static stub whose `matches` is decided per query. */
export function stubMatchMedia(matches: (query: string) => boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(
      (query: string) =>
        ({
          matches: matches(query),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }) satisfies MediaQueryList,
    ),
  );
}
