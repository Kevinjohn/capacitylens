type Identified = { id: string };
type Named = Identified & { name: string };

// CapacityLens is currently English-only. Pinning the locale keeps management-list order independent
// of the host/browser locale; exact spelling and id then make every collation tie deterministic.
const displayNameCollator = new Intl.Collator("en", {
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

export const byName = displayNameComparator<Named>((item) => item.name);
