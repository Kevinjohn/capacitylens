import type { ReactNode } from 'react';
import { PermissionContext } from '@/auth/permissionContext';
import { permissionValue } from './permissionGrants';

/** Ordinary component fixtures explicitly act as a resolved Owner; authority tests provide their own context. */
export function OwnerPermissions({ children }: { children: ReactNode }) {
  return (
    <PermissionContext.Provider value={permissionValue('owner')}>
      {children}
    </PermissionContext.Provider>
  );
}
