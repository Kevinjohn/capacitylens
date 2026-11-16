import type { Resource, ResourceKind } from '@capacitylens/shared/types/entities';
import { m } from '@/i18n';
import {
  createDisplayNameComparator,
  createEngagementFavouriteDisplayNameComparator,
  createFavouriteDisplayNameComparator,
} from '@/lib/displayOrder';
import { resolvePlaceholderDisplayName, resolveResourceDisplayName } from '@/lib/metadata';

/** The company switches that decide which resource kinds are shown. People are always shown. */
export interface EnabledResourceKinds {
  placeholdersEnabled: boolean;
  externalEnabled: boolean;
}

/** Returns whether the company has switched on this resource's kind. */
export function isResourceKindEnabled(
  resource: { kind: ResourceKind },
  kinds: EnabledResourceKinds,
): boolean {
  switch (resource.kind) {
    case 'person':
      return true;
    case 'placeholder':
      return kinds.placeholdersEnabled;
    case 'external':
      return kinds.externalEnabled;
  }
}

/** The stable keys of the bands that do not come from a discipline. */
export type ResourceBandKey =
  | 'resources'
  | 'overall'
  | 'unassigned'
  | 'placeholders'
  | 'external'
  | 'engagement-studio'
  | 'engagement-supplementary';

/** A heading over a set of resource rows. */
export interface ResourceBand {
  key: string;
  title: string;
  color?: string;
}

/** A band and the resources under it, before any sorting. */
export interface ResourceBandGroup extends ResourceBand {
  resources: Resource[];
}

// Titles are looked up per call so a locale change is never served stale copy.
function resolveResourceBandTitle(key: ResourceBandKey): string {
  switch (key) {
    case 'resources':
      return m.resource_group_resources();
    case 'overall':
      return m.resource_group_overall();
    case 'unassigned':
      return m.resource_group_unassigned();
    case 'placeholders':
      return m.resource_group_unassigned_demand();
    case 'external':
      return m.resource_group_external();
    case 'engagement-studio':
      return m.resource_group_studio();
    case 'engagement-supplementary':
      return m.resource_group_supplementary();
  }
}

/** Builds a non-discipline band with its title from the message layer. */
export function buildResourceBand(key: ResourceBandKey): ResourceBand {
  return { key, title: resolveResourceBandTitle(key) };
}

interface BuildEngagementGroupsInput {
  resources: Resource[];
  groupByEngagement: boolean;
  /** The single band used when engagement grouping is off; its colour carries into both halves. */
  ungrouped: ResourceBand;
}

/**
 * Builds the bands for resources that have no discipline band: Studio then Supplementary when the
 * company groups by engagement, otherwise the single `ungrouped` band. Empty bands are omitted.
 */
export function buildEngagementGroups({
  resources,
  groupByEngagement,
  ungrouped,
}: BuildEngagementGroupsInput): ResourceBandGroup[] {
  if (!groupByEngagement) {
    return resources.length ? [{ ...ungrouped, resources }] : [];
  }
  const engagementGroups: ResourceBandGroup[] = [
    {
      ...ungrouped,
      ...buildResourceBand('engagement-studio'),
      resources: resources.filter((resource) => resource.engagement === 'studio'),
    },
    {
      ...ungrouped,
      ...buildResourceBand('engagement-supplementary'),
      resources: resources.filter((resource) => resource.engagement === 'supplementary'),
    },
  ];
  return engagementGroups.filter((group) => group.resources.length > 0);
}

/**
 * Creates the one resource order used by the schedule, the capacity overview and the Resources
 * list: placeholders after everyone else and by name; everyone else favourites first and by name,
 * Studio before Supplementary when the company groups by engagement.
 */
export function createResourceComparator(
  groupByEngagement: boolean,
): (left: Resource, right: Resource) => number {
  // Resolve the placeholder label once per comparator so a sort does not look it up per pair.
  const placeholderLabel = resolvePlaceholderDisplayName();
  const resolveDisplayName = (resource: Resource): string =>
    resource.kind === 'placeholder' ? placeholderLabel : resolveResourceDisplayName(resource);
  const byDisplayName = createDisplayNameComparator<Resource>(resolveDisplayName);
  const comparePeople = groupByEngagement
    ? createEngagementFavouriteDisplayNameComparator<Resource>(resolveDisplayName)
    : createFavouriteDisplayNameComparator<Resource>(resolveDisplayName);
  return (left, right) => {
    const placeholderOrder =
      Number(left.kind === 'placeholder') - Number(right.kind === 'placeholder');
    if (placeholderOrder !== 0) return placeholderOrder;
    return left.kind === 'placeholder' ? byDisplayName(left, right) : comparePeople(left, right);
  };
}
