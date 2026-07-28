// Text hygiene for user-entered free text (names, roles, notes). Two surfaces use it:
//   - the FORMS reject disallowed input via hasDisallowedChars (so the user fixes it);
//   - the IMPORT + SERVER write paths can't show a form error, so they STRIP it via
//     cleanText (consistent with the rest of sanitizeImport's repair-don't-reject rule).
// One source definition is imported by client + server, so the policy cannot drift in code.
// Unicode property escapes use the executing engine's Unicode tables, however; supported browser
// and server runtimes must stay within the documented baseline and can briefly classify newly
// assigned code points differently during an engine rollout.

/** Max Unicode code points for a single-line name / role / label. */
export const MAX_NAME_LENGTH = 100;
/** HTML maxlength is UTF-16 based; allow the worst-case transport size for the code-point policy. */
export const MAX_NAME_INPUT_CODE_UNITS = MAX_NAME_LENGTH * 2;
/** Practical UTF-8 byte maximum for an email accepted by identity/invite forms and server writes. */
export const MAX_EMAIL_LENGTH = 254;
/** Max Unicode code points for a multi-line note. */
export const MAX_NOTE_LENGTH = 1000;
export const MAX_NOTE_INPUT_CODE_UNITS = MAX_NOTE_LENGTH * 2;

export function unicodeCharacterCount(value: string): number {
  return Array.from(value).length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

// Characters refused in user text: emoji & pictographs (Extended_Pictographic), "other"
// symbols (So — covers flag emoji / regional indicators, keycaps and dingbats that aren't
// Extended_Pictographic, plus ™ © ® ° and the like), ENCLOSING marks (Me — the combining
// enclosing keycap U+20E3 that turns "1"/"#"/"*" into keycap emoji; no legitimate name
// char is enclosing), the VARIATION SELECTORS (U+FE00–FE0F incl. emoji VS-16 U+FE0F, and
// the supplement U+E0100–E01EF) that force emoji presentation, control chars (Cc), format
// / zero-width chars (Cf — ZWJ, RTL overrides, …), lone surrogates (Cs), private-use (Co)
// and unassigned (Cn) code points. Cn is deliberately conservative: a code point is refused until
// the executing runtime knows its assigned category. Removing it would let an older runtime accept
// a newly assigned symbol that a newer runtime rejects as So or Extended_Pictographic.
// NOTE we deliberately do NOT ban Nonspacing_Mark (Mn)
// wholesale — that would strip legitimate decomposed accents (e.g. "e" + U+0301) — we
// target only U+FE0F via the variation-selector range. Ordinary letters (incl. accents +
// CJK), digits, whitespace, punctuation, and currency/math symbols (Sc/Sm — €, £, +, =)
// are allowed, so real names like "José Müller" or "O'Brien & Co" pass untouched.
const DISALLOWED =
  /[\p{Extended_Pictographic}\p{So}\p{Me}\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u;

/** True if `s` contains any disallowed character. In multiline mode, newlines and tabs
 *  (both Cc) are exempt so a note can wrap. */
export function hasDisallowedChars(s: string, opts: { multiline?: boolean } = {}): boolean {
  const subject = opts.multiline ? s.replace(/[\n\t]/g, "") : s;
  return DISALLOWED.test(subject);
}

/** Strip disallowed characters, collapse whitespace runs, trim, and cap length. Used on
 *  the import + server write paths where rejecting isn't an option. Iterates by code
 *  point so surrogate pairs / emoji are dropped as whole characters. */
export function cleanText(value: string, opts: { multiline?: boolean; maxLength?: number } = {}): string {
  const multiline = opts.multiline ?? false;
  let out = "";
  for (const ch of value) {
    // Newlines and tabs are whitespace, not junk — keep them through the strip pass and
    // let the normalisation step below decide (→ a space in single-line, preserved in
    // multiline). Everything else in a disallowed category is dropped.
    if (ch === "\n" || ch === "\t") {
      out += ch;
      continue;
    }
    if (!DISALLOWED.test(ch)) out += ch;
  }
  // Normalise whitespace: collapse horizontal runs to a single space. In multiline keep
  // newlines (but cap blank-line runs); single-line collapses everything to one space.
  out = multiline ? out.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n") : out.replace(/\s+/g, " ");
  out = out.trim();
  const max = opts.maxLength ?? (multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH);
  if (unicodeCharacterCount(out) <= max) return out;
  let truncated = "";
  let count = 0;
  for (const ch of out) {
    if (count === max) break;
    truncated += ch;
    count += 1;
  }
  return truncated.trim();
}
