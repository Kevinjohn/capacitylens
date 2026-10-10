// Text hygiene for user-entered free text (names, roles, notes). Two surfaces use it:
//   - the forms reject disallowed input via hasDisallowedChars (so the user fixes it);
//   - import strips disallowed characters via cleanText;
//   - ordinary server writes reject disallowed supplied characters before canonicalization
//     for the same NFC and whitespace normalization as the forms.
// One source definition is imported by client + server, so the policy cannot drift in code.
// Unicode property escapes use the executing engine's Unicode tables, however; supported browser
// and server runtimes must stay within the documented baseline and can briefly classify newly
// assigned code points differently during an engine rollout.

/** Max Unicode code points for a single-line name / role / label. */
export const MAX_NAME_LENGTH = 100;
/** Practical UTF-8 byte maximum for an email accepted by identity/invite forms and server writes. */
export const MAX_EMAIL_LENGTH = 254;
/** Max Unicode code points for a multi-line note. */
export const MAX_NOTE_LENGTH = 1000;

/** Length in Unicode code points, the unit every `MAX_*_LENGTH` text limit uses. */
export function unicodeCharacterCount(value: string): number {
  return Array.from(value).length;
}

// Stateless and reusable, build it once at module scope (same idiom as GRAPHEME_SEGMENTER below)
// instead of allocating a fresh encoder on every length check.
const TEXT_ENCODER = new TextEncoder();

/** Length in UTF-8 bytes, the unit of {@link MAX_EMAIL_LENGTH}. */
export function utf8ByteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

// Characters refused in user text: emoji & pictographs (Extended_Pictographic), "other"
// symbols (So, covers flag emoji / regional indicators, keycaps and dingbats that aren't
// Extended_Pictographic, plus ™ © ® ° and the like), enclosing marks (Me, the combining
// enclosing keycap U+20E3 that turns "1"/"#"/"*" into keycap emoji; no legitimate name
// char is enclosing), the VARIATION SELECTORS (U+FE00–FE0F incl. emoji VS-16 U+FE0F, and
// the supplement U+E0100–E01EF) that force emoji presentation, control chars (Cc), format
// / zero-width chars (Cf, ZWJ, RTL overrides, …), lone surrogates (Cs), private-use (Co)
// and unassigned (Cn) code points. Cn is deliberately conservative: a code point is refused until
// the executing runtime knows its assigned category. Removing it would let an older runtime accept
// a newly assigned symbol that a newer runtime rejects as So or Extended_Pictographic.
// Note we deliberately do not ban Nonspacing_Mark (Mn)
// wholesale: that would strip legitimate decomposed accents (e.g. "e" + U+0301), we
// target only U+FE0F via the variation-selector range. Ordinary letters (incl. accents +
// CJK), digits, whitespace, punctuation, and currency/math symbols (Sc/Sm, €, £, +, =)
// are allowed, so real names like "José Müller" or "O'Brien & Co" pass untouched.
const DISALLOWED =
  /[\p{Extended_Pictographic}\p{So}\p{Me}\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/u;

const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

/** True if `value` contains any disallowed character. In multiline mode, newlines and tabs
 * (both Cc) are exempt so a note can wrap. */
export function hasDisallowedChars(value: string, options: { multiline?: boolean } = {}): boolean {
  const subject = options.multiline ? value.replace(/[\n\t]/g, "") : value;
  return DISALLOWED.test(subject);
}

function stripDisallowedCharacters(value: string): string {
  let cleaned = "";
  for (const character of value.normalize("NFC")) {
    // Newlines and tabs are whitespace, not junk, keep them through the strip pass and
    // let the normalisation step below decide (→ a space in single-line, preserved in multiline).
    if (character === "\n" || character === "\t" || !DISALLOWED.test(character)) cleaned += character;
  }
  return cleaned;
}

/** Canonicalize user-authored plain text before applying the shared character and length policy.
 * This preserves punctuation and letters; it never strips disallowed characters or truncates. */
export function normalizeUserText(value: string, options: { multiline?: boolean } = {}): string {
  const normalized = value.normalize("NFC");
  return (
    options.multiline
      ? normalized.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n")
      : normalized.replace(/\s+/g, " ")
  ).trim();
}

/** Return a valid canonical single-line name without dropping or truncating supplied characters. */
export function parseUserName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const canonical = value.normalize("NFC");
  const normalized = normalizeUserText(canonical);
  if (!normalized || hasDisallowedChars(canonical) || unicodeCharacterCount(normalized) > MAX_NAME_LENGTH) return null;
  return normalized;
}

/** Strip disallowed characters, collapse whitespace runs, trim, and cap length. Used on
 * import repair paths after ordinary writes have been validated. Iterates by code
 * point so surrogate pairs / emoji are dropped as whole characters. */
export function cleanText(value: string, options: { multiline?: boolean; maxLength?: number } = {}): string {
  const multiline = options.multiline ?? false;
  let out = stripDisallowedCharacters(value);
  out = normalizeUserText(out, { multiline });
  const max = options.maxLength ?? (multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH);
  if (unicodeCharacterCount(out) <= max) return out;
  // Keep the existing code-point budget, but never spend only part of a grapheme cluster. This
  // avoids changing a visible character by dropping its combining tail at the boundary.
  let truncated = "";
  let count = 0;
  for (const { segment } of GRAPHEME_SEGMENTER.segment(out)) {
    const segmentLength = unicodeCharacterCount(segment);
    if (count + segmentLength > max) break;
    truncated += segment;
    count += segmentLength;
  }
  return truncated.trim();
}
