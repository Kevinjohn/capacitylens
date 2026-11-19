import type { ResourceEngagement } from '@capacitylens/shared/types/entities';

interface CompareDisplayNamesInput {
  leftName: string;
  leftId: string;
  rightName: string;
  rightId: string;
}

type Identified = { id: string };
type Named = Identified & { name: string };
type DisplayNamed = Named & { displayName?: string };
type ClientProject = DisplayNamed & { clientId: string };

// CapacityLens is currently English-only. Pinning the locale keeps management-list order independent
// of the host/browser locale; exact spelling and id then make every collation tie deterministic.
const displayNameCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base',
  usage: 'sort',
});

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNamesAndIds({
  leftName,
  leftId,
  rightName,
  rightId,
}: CompareDisplayNamesInput): number {
  return (
    displayNameCollator.compare(leftName, rightName) ||
    compareCodeUnits(leftName, rightName) ||
    compareCodeUnits(leftId, rightId)
  );
}

/** Sorts names consistently, using stable IDs to break ties. */
export function compareDisplayNames({
  leftName,
  leftId,
  rightName,
  rightId,
}: CompareDisplayNamesInput): number {
  return compareNamesAndIds({ leftName, leftId, rightName, rightId });
}

/** Creates a comparator that sorts items by display name and stable ID. */
export function createDisplayNameComparator<T extends Identified>(
  displayName: (item: T) => string,
) {
  return (left: T, right: T): number =>
    compareDisplayNames({
      leftName: displayName(left),
      leftId: left.id,
      rightName: displayName(right),
      rightId: right.id,
    });
}

/** The label the server chose for this reader; rows built without it order by name. */
const getOrderingName = (item: DisplayNamed) => item.displayName ?? item.name;

/** Shared client-first project ordering for project selectors and management views. */
export function createClientProjectDisplayNameComparator<T extends ClientProject>(
  clients: DisplayNamed[],
) {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  return (left: T, right: T): number => {
    const leftClient = clientsById.get(left.clientId);
    const rightClient = clientsById.get(right.clientId);
    const clientOrder = compareDisplayNames({
      leftName: leftClient ? getOrderingName(leftClient) : '',
      leftId: left.clientId,
      rightName: rightClient ? getOrderingName(rightClient) : '',
      rightId: right.clientId,
    });
    return (
      clientOrder ||
      compareDisplayNames({
        leftName: getOrderingName(left),
        leftId: left.id,
        rightName: getOrderingName(right),
        rightId: right.id,
      })
    );
  };
}

/** Creates a comparator that places favourites before other items, then sorts names. */
export function createFavouriteDisplayNameComparator<
  T extends Identified & { isFavourite?: boolean | null },
>(displayName: (item: T) => string) {
  const byDisplayName = createDisplayNameComparator(displayName);
  return (left: T, right: T): number =>
    Number(right.isFavourite === true) - Number(left.isFavourite === true) ||
    byDisplayName(left, right);
}

/** Studio before Supplementary, then favourites first and deterministic display-name order within
 * each engagement partition. Used by both Resources and the scheduler so the two views cannot drift. */
export function createEngagementFavouriteDisplayNameComparator<
  T extends Identified & { engagement: ResourceEngagement; isFavourite?: boolean | null },
>(displayName: (item: T) => string) {
  const byFavouriteDisplayName = createFavouriteDisplayNameComparator(displayName);
  return (left: T, right: T): number =>
    Number(left.engagement === 'supplementary') - Number(right.engagement === 'supplementary') ||
    byFavouriteDisplayName(left, right);
}

/** Default comparator for named items. */
export const byName = createDisplayNameComparator<Named>((item) => item.name);
