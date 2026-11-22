import { describe, expect, it } from 'vitest';
import { makeResource } from '@/test/fixtures';
import {
  buildEngagementGroups,
  buildResourceBand,
  createResourceComparator,
  isResourceKindEnabled,
} from './resourceGrouping';

describe('resource grouping and kind rules', () => {
  it('always enables people and follows the company switch for the other kinds', () => {
    const allOff = { placeholdersEnabled: false, externalEnabled: false };
    expect(isResourceKindEnabled({ kind: 'person' }, allOff)).toBe(true);
    expect(isResourceKindEnabled({ kind: 'placeholder' }, allOff)).toBe(false);
    expect(isResourceKindEnabled({ kind: 'external' }, allOff)).toBe(false);
    expect(
      isResourceKindEnabled({ kind: 'placeholder' }, { ...allOff, placeholdersEnabled: true }),
    ).toBe(true);
    expect(isResourceKindEnabled({ kind: 'external' }, { ...allOff, externalEnabled: true })).toBe(
      true,
    );
  });

  it('takes band titles from the message layer', () => {
    expect(
      (
        [
          'resources',
          'overall',
          'unassigned',
          'placeholders',
          'external',
          'engagement-studio',
          'engagement-supplementary',
        ] as const
      ).map(buildResourceBand),
    ).toEqual([
      { key: 'resources', title: 'Resources' },
      { key: 'overall', title: 'Overall' },
      { key: 'unassigned', title: 'Unassigned' },
      { key: 'placeholders', title: 'Unassigned demand' },
      { key: 'external', title: 'External party' },
      { key: 'engagement-studio', title: 'Studio' },
      { key: 'engagement-supplementary', title: 'Supplementary' },
    ]);
  });

  it('splits by engagement, keeps the band colour and drops empty bands', () => {
    const studio = makeResource({ id: 'studio', engagement: 'studio' });
    const supplementary = makeResource({ id: 'supplementary', engagement: 'supplementary' });
    const ungrouped = { ...buildResourceBand('unassigned'), color: '#777777' };

    expect(
      buildEngagementGroups({
        resources: [supplementary, studio],
        groupByEngagement: true,
        ungrouped,
      }),
    ).toEqual([
      { key: 'engagement-studio', title: 'Studio', color: '#777777', resources: [studio] },
      {
        key: 'engagement-supplementary',
        title: 'Supplementary',
        color: '#777777',
        resources: [supplementary],
      },
    ]);
    expect(
      buildEngagementGroups({ resources: [studio], groupByEngagement: true, ungrouped }).map(
        (group) => group.key,
      ),
    ).toEqual(['engagement-studio']);
    expect(
      buildEngagementGroups({ resources: [studio], groupByEngagement: false, ungrouped }),
    ).toEqual([{ ...ungrouped, resources: [studio] }]);
    expect(buildEngagementGroups({ resources: [], groupByEngagement: false, ungrouped })).toEqual(
      [],
    );
  });

  it('orders people by engagement, favourite and name, then placeholders by name', () => {
    const resources = [
      makeResource({ id: 'p2', kind: 'placeholder', name: null }),
      makeResource({ id: 'sup', name: 'Arthur Curry', engagement: 'supplementary' }),
      makeResource({ id: 'bruce', name: 'Bruce Wayne' }),
      makeResource({ id: 'p1', kind: 'placeholder', name: null }),
      makeResource({ id: 'fav', name: 'Zatanna Zatara', isFavourite: true }),
      makeResource({ id: 'diana', name: 'Diana Prince' }),
    ];

    expect([...resources].sort(createResourceComparator(true)).map(({ id }) => id)).toEqual([
      'fav',
      'bruce',
      'diana',
      'sup',
      'p1',
      'p2',
    ]);
    expect([...resources].sort(createResourceComparator(false)).map(({ id }) => id)).toEqual([
      'fav',
      'sup',
      'bruce',
      'diana',
      'p1',
      'p2',
    ]);
  });
});
