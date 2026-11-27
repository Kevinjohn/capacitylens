export const expected = {
  owner: {
    permissions: [
      'planning:read',
      'planning:write',
      'members:list',
      'members:manage',
      'members:signInTracking',
      'invitations:manage',
      'masquerade:use',
      'resources:anonymise',
      'ownership:transfer',
      'company:import',
      'company:anonymise',
    ],
    canSeePrivateNames: true,
    canSeeTimeOffNote: true,
  },
  admin: {
    permissions: [
      'planning:read',
      'planning:write',
      'members:list',
      'members:manage',
      'invitations:manage',
      'masquerade:use',
      'resources:anonymise',
    ],
    canSeePrivateNames: false,
    canSeeTimeOffNote: true,
  },
  editor: {
    permissions: ['planning:read', 'planning:write'],
    canSeePrivateNames: false,
    canSeeTimeOffNote: false,
  },
  viewer: {
    permissions: ['planning:read'],
    canSeePrivateNames: false,
    canSeeTimeOffNote: false,
  },
} as const
