type Identified = { id: string };
type Named = Identified & { name: string };

// CapacityLens is currently English-only. Pinning the locale keeps management-list order independent
// of the host/browser locale; exact spelling and id then make every collation tie deterministic.
const displayNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
  usage: "sort",
});

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareDisplayNames(leftName: string, leftId: string, rightName: string, rightId: string): number {
  return (
    displayNameCollator.compare(leftName, rightName) ||
    compareCodeUnits(leftName, rightName) ||
    compareCodeUnits(leftId, rightId)
  );
}

export function displayNameComparator<T extends Identified>(displayName: (item: T) => string) {
  return (left: T, right: T): number => compareDisplayNames(displayName(left), left.id, displayName(right), right.id);
}

export function favouriteDisplayNameComparator<T extends Identified & { isFavourite?: boolean }>(
  displayName: (item: T) => string,
) {
  const byDisplayName = displayNameComparator(displayName);
  return (left: T, right: T): number =>
    Number(right.isFavourite === true) - Number(left.isFavourite === true) || byDisplayName(left, right);
}

/** Studio before Supplementary, then favourites first and deterministic display-name order within
 * each engagement partition. Used by both Resources and the scheduler so the two views cannot drift. */
export function engagementFavouriteDisplayNameComparator<
  T extends Identified & { engagement: "studio" | "supplementary"; isFavourite?: boolean },
>(displayName: (item: T) => string) {
  const byFavouriteDisplayName = favouriteDisplayNameComparator(displayName);
  return (left: T, right: T): number =>
    Number(left.engagement === "supplementary") - Number(right.engagement === "supplementary") ||
    byFavouriteDisplayName(left, right);
}

export const byName = displayNameComparator<Named>((item) => item.name);
