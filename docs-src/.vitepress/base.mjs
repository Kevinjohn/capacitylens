// The deploy base, in one place.
//
// Two things need it and would silently disagree if each kept its own copy:
// the VitePress config (which prefixes every absolute URL it emits) and
// scripts/docs-standalone.mjs (which rewrites those URLs back to relative ones
// and then verifies none survived). A stale copy in the script means it looks
// for a prefix the build no longer emits — and passes a broken build.
//
// Plain .mjs so the postbuild script can import it under bare Node, with no
// TypeScript loader.
export const BASE = "/capacitylens/";
