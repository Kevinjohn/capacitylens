import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/api/queryClient';
import { useStore } from '@/store/useStore';
import { authApi } from './authApi';
import { AUTH_INVALIDATION_STORAGE_KEY, signOutAndReload } from './signOut';

afterEach(() => {
  queryClient.clear();
  useStore.getState().clearPlanning();
  localStorage.removeItem(AUTH_INVALIDATION_STORAGE_KEY);
  vi.restoreAllMocks();
});

describe('signOutAndReload', () => {
  it('clears private data and notifies sibling tabs before reloading after success', async () => {
    queryClient.setQueryData(['private-account'], 'sensitive data');
    useStore.setState({ activeCompanyId: 'gotham' });
    const clearAccountCommands = vi.fn();
    const reload = vi.fn(() => {
      expect(queryClient.getQueryData(['private-account'])).toBeUndefined();
      expect(useStore.getState().activeCompanyId).toBeNull();
      expect(clearAccountCommands).toHaveBeenCalledOnce();
      expect(localStorage.getItem(AUTH_INVALIDATION_STORAGE_KEY)).toMatch(/^[0-9a-f-]{36}$/i);
    });

    vi.spyOn(authApi, 'signOut').mockResolvedValue({ data: null, error: null });
    await signOutAndReload({
      clearAccountCommands,
      reload,
    });

    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([
    ['a rejected request', () => Promise.reject(new Error('Connection lost.')), 'Connection lost.'],
    [
      'a server refusal',
      async () => ({ data: null, error: { status: 503, message: 'Session service is busy.' } }),
      'Session service is busy.',
    ],
  ] as const)(
    'reports %s and leaves the current session in place',
    async (_, requestSignOut, message) => {
      queryClient.setQueryData(['private-account'], 'sensitive data');
      useStore.setState({ activeCompanyId: 'gotham' });
      const clearAccountCommands = vi.fn();
      const reload = vi.fn();

      vi.spyOn(authApi, 'signOut').mockImplementation(requestSignOut);
      await expect(signOutAndReload({ clearAccountCommands, reload })).rejects.toThrow(message);
      expect(localStorage.getItem(AUTH_INVALIDATION_STORAGE_KEY)).toBeNull();
      expect(reload).not.toHaveBeenCalled();
      expect(clearAccountCommands).not.toHaveBeenCalled();
      expect(useStore.getState().activeCompanyId).toBe('gotham');
      expect(queryClient.getQueryData(['private-account'])).toBe('sensitive data');
    },
  );
});
