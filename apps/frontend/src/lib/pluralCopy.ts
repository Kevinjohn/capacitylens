/** Builds a count formatter that picks the one or other message for a count. Resolve plural copy
 * at lookup so it follows the current locale; the catalogue currently uses the English
 * one-versus-other categories. */
export const plural =
  (one: (inputs: { count: number }) => string, other: (inputs: { count: number }) => string) =>
  (count: number): string =>
    count === 1 ? one({ count }) : other({ count });
