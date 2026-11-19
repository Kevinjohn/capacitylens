import { describe, expect, it } from 'vitest';
import type { Role } from '@capacitylens/shared/domain/access';
import { ROLES } from '@capacitylens/shared/account/types';
import type { CapacityOverviewAccess } from '@capacitylens/shared/types/entities';
import { listVisibleRoutes } from '@/lib/navLinks';
import { buildRouteVisibilityContext } from './useVisibleRoutes';

// Every route shown to everyone, in table order, with the role-gated and optional routes left out.
const COMMON = [
  '/',
  '/resources',
  '/clients',
  '/projects',
  '/activities',
  '/timeoff',
  '/team',
  '/settings',
  '/help',
  '/account',
];

function listPaths(input: Parameters<typeof buildRouteVisibilityContext>[0]) {
  return listVisibleRoutes(buildRouteVisibilityContext(input)).map(({ to }) => to);
}

function listExpected(extra: { overview: boolean; disciplines: boolean; diagnostics: boolean }) {
  return [
    ...(extra.overview ? ['/overview'] : []),
    ...COMMON.slice(0, 2),
    ...(extra.disciplines ? ['/disciplines'] : []),
    ...COMMON.slice(2, 8),
    ...(extra.diagnostics ? ['/diagnostics'] : []),
    ...COMMON.slice(8),
  ];
}

// An independent oracle: which roles see the capacity overview under each company setting.
const OVERVIEW_ROLES: Record<CapacityOverviewAccess, readonly Role[]> = {
  owner_admin: ['owner', 'admin'],
  owner_admin_editor: ['owner', 'admin', 'editor'],
  everyone: ['owner', 'admin', 'editor', 'viewer'],
};

describe('route table visibility per role', () => {
  const settings = Object.keys(OVERVIEW_ROLES) as CapacityOverviewAccess[];
  const cases = ROLES.flatMap((role) =>
    settings.flatMap((access) =>
      [true, false].map((disciplines) => ({ role, access, disciplines })),
    ),
  );

  it.each(cases)(
    '$role with overview access $access and disciplines $disciplines',
    ({ role, access, disciplines }) => {
      expect(
        listPaths({
          role,
          status: 'resolved',
          capacityOverviewAccess: access,
          disciplinesEnabled: disciplines,
        }),
      ).toEqual(
        listExpected({
          overview: OVERVIEW_ROLES[access].includes(role),
          disciplines,
          diagnostics: role === 'owner' || role === 'admin',
        }),
      );
    },
  );

  it.each(['pending', 'unavailable'] as const)(
    'hides role-gated routes while the role is %s',
    (status) => {
      expect(
        listPaths({
          role: 'owner',
          status,
          capacityOverviewAccess: 'everyone',
          disciplinesEnabled: true,
        }),
      ).toEqual(listExpected({ overview: false, disciplines: true, diagnostics: false }));
    },
  );

  it('hides role-gated routes when no membership role applies', () => {
    expect(
      listPaths({
        role: null,
        status: 'not-applicable',
        capacityOverviewAccess: 'everyone',
        disciplinesEnabled: true,
      }),
    ).toEqual(listExpected({ overview: false, disciplines: true, diagnostics: false }));
  });
});
