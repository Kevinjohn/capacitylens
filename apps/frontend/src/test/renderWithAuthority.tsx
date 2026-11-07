import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import type { RenderOptions } from '@testing-library/react';
import { PermissionContext } from '@/auth/permissionContext';
import { useStore } from '@/store/useStore';

/**
 * `render` with the store's published authority as the permission context, as PermissionProvider
 * publishes it to both. Any caller-supplied wrapper stays innermost.
 */
export function renderWithAuthority(ui: ReactElement, options: RenderOptions = {}) {
  const Inner = options.wrapper;
  return render(ui, {
    ...options,
    wrapper: function StoreAuthority({ children }: { children: ReactNode }) {
      const role = useStore((state) => state.activeRole);
      const status = useStore((state) => state.activeRoleStatus);
      const access = useStore((state) => state.activeAccess);
      return (
        <PermissionContext.Provider value={{ role, status, access }}>
          {Inner ? <Inner>{children}</Inner> : children}
        </PermissionContext.Provider>
      );
    },
  });
}
