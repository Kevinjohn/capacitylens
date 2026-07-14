// Text hygiene for user-entered free text (names, roles, notes). Two surfaces use it:
//   - the FORMS reject disallowed input via hasDisallowedChars (so the user fixes it);
//   - the IMPORT + SERVER write paths can't show a form error, so they STRIP it via
//     cleanText (consistent with the rest of sanitizeImport's repair-don't-reject rule).
// One definition, imported by client + server, so the two paths can never drift.

/** Max length for a single-line name / role / label. */
export const MAX_NAME_LENGTH = 100
/** Practical maximum for an email address accepted by identity/invite forms and server writes. */
export const MAX_EMAIL_LENGTH = 254
/** Max length for a multi-line note. */
export const MAX_NOTE_LENGTH = 1000

// Characters refused in user text: emoji & pictographs (Extended_Pictographic), "other"
// symbols (So — covers flag emoji / regional indicators, keycaps and dingbats that aren't
// Extended_Pictographic, plus ™ © ® ° and the like), ENCLOSING marks (Me — the combining
// enclosing keycap U+20E3 that turns "1"/"#"/"*" into keycap emoji; no legitimate name
// char is enclosing), the VARIATION SELECTORS (U+FE00–FE0F incl. emoji VS-16 U+FE0F, and
// the supplement U+E0100–E01EF) that force emoji presentation, control chars (Cc), format
// / zero-width chars (Cf — ZWJ, RTL overrides, …), lone surrogates (Cs), private-use (Co)
// and unassigned (Cn) code points. NOTE we deliberately do NOT ban Nonspacing_Mark (Mn)
// wholesale — that would strip legitimate decomposed accents (e.g. "e" + U+0301) — we
// target only U+FE0F via the variation-selector range. Ordinary letters (incl. accents +
// CJK), digits, whitespace, punctuation, and currency/math symbols (Sc/Sm — €, £, +, =)
// are allowed, so real names like "José Müller" or "O'Brien & Co" pass untouched.
const DISALLOWED =
  /[\p{Extended_Pictographic}\p{So}\p{Me}\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u

/** True if `s` contains any disallowed character. In multiline mode, newlines and tabs
 *  (both Cc) are exempt so a note can wrap. */
export function hasDisallowedChars(s: string, opts: { multiline?: boolean } = {}): boolean {
  const subject = opts.multiline ? s.replace(/[\n\t]/g, '') : s
  return DISALLOWED.test(subject)
}

/** Strip disallowed characters, collapse whitespace runs, trim, and cap length. Used on
 *  the import + server write paths where rejecting isn't an option. Iterates by code
 *  point so surrogate pairs / emoji are dropped as whole characters. */
export function cleanText(value: string, opts: { multiline?: boolean; maxLength?: number } = {}): string {
  const multiline = opts.multiline ?? false
  let out = ''
  for (const ch of value) {
    // Newlines and tabs are whitespace, not junk — keep them through the strip pass and
    // let the normalisation step below decide (→ a space in single-line, preserved in
    // multiline). Everything else in a disallowed category is dropped.
    if (ch === '\n' || ch === '\t') {
      out += ch
      continue
    }
    if (!DISALLOWED.test(ch)) out += ch
  }
  // Normalise whitespace: collapse horizontal runs to a single space. In multiline keep
  // newlines (but cap blank-line runs); single-line collapses everything to one space.
  out = multiline ? out.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n') : out.replace(/\s+/g, ' ')
  out = out.trim()
  const max = opts.maxLength ?? (multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH)
  if (out.length <= max) return out
  let truncated = ''
  for (const ch of out) {
    if (truncated.length + ch.length > max) break
    truncated += ch
  }
  return truncated.trim()
}
