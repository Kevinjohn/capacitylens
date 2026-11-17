import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { PlanningControllerError } from '@/data/planning/planningErrors';
import { useStore } from '@/store/useStore';
import { m } from '@/i18n';
import { setUpAppShellTests, renderAppShell } from './AppShell.testSupport';

const i18nMocks = vi.hoisted(() => ({ syncLocaleFromAccount: vi.fn() }));
vi.mock('@/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n')>()),
  syncLocaleFromAccount: i18nMocks.syncLocaleFromAccount,
}));

setUpAppShellTests(i18nMocks.syncLocaleFromAccount);

it('guards navigation while a typed planning write is unacknowledged', () => {
  const { unmount } = renderAppShell({});
  act(() => {
    useStore.setState((state) => ({
      planning: { ...state.planning, pending: {} as NonNullable<typeof state.planning.pending> },
    }));
  });

  const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
  window.dispatchEvent(event);

  expect(useStore.getState().dirtyForm).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  unmount();
});

describe('AppShell hydration gate', () => {
  beforeEach(() => useStore.getState().setHydrated(false));

  it('shows "Loading…" when the store is not hydrated', () => {
    renderAppShell({});

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('does not render the outlet area when not hydrated', () => {
    renderAppShell({});

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('main')?.textContent).toContain('Loading');
  });

  it('hides "Loading…" and renders outlet area after setHydrated(true)', () => {
    renderAppShell({});

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    act(() => {
      useStore.getState().setHydrated(true);
    });

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('renders outlet area immediately when hydrated is already true', () => {
    useStore.getState().setHydrated(true);

    renderAppShell({});

    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });
});

describe('AppShell planning problems', () => {
  it.each([
    [
      'refused',
      new PlanningControllerError('Refused.', 'ACCOUNT_MEMBERSHIP_LOST', 403),
      m.app_planning_refused(),
    ],
    ['error', new Error('Network down'), m.app_planning_unavailable()],
  ] as const)('shows a visible alert for a %s planning state', (status, error, text) => {
    useStore.getState().setHydrated(true);
    renderAppShell({});

    act(() => useStore.setState((state) => ({ planning: { ...state.planning, status, error } })));

    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });

  it('asks the person to check a change whose reply was lost', () => {
    useStore.getState().setHydrated(true);
    renderAppShell({});

    act(() =>
      useStore.setState((state) => ({
        planning: {
          ...state.planning,
          status: 'ready',
          error: null,
          outcome: { kind: 'unconfirmed', mutationId: 'mutation-1' },
        },
      })),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(m.app_planning_unconfirmed());
  });
});

describe('AppShell transient notice', () => {
  // Sonner renders notices asynchronously in its own polite live region, so this suite awaits its portal markup.
  it('renders a Sonner toast for an info store notice and clears it on dismiss', async () => {
    renderAppShell({});
    expect(screen.queryByText(/could not be moved/)).not.toBeInTheDocument();

    act(() => {
      useStore.getState().setNotice('That allocation could not be moved there.');
    });
    // Wait for Sonner's portal before asserting the notification live region.
    const message = await screen.findByText(/could not be moved/);
    expect(message.closest('[data-sonner-toast]')).not.toBeNull();
    expect(message.closest('[aria-live="polite"]')).not.toBeNull();

    act(() => {
      screen.getByRole('button', { name: 'Close toast' }).click();
    });
    await waitFor(() => expect(useStore.getState().notice).toBeNull());
    await waitFor(() => expect(screen.queryByText(/could not be moved/)).not.toBeInTheDocument());
  });
  it('keeps an ERROR notice on screen past the 4s info window (no auto-dismiss), unlike info', async () => {
    // Fake timers exercise auto-dismiss and exit animations without real waits. Read synchronously after advancing timers so polling cannot stall while the clock is paused.
    vi.useFakeTimers();
    try {
      renderAppShell({});

      // Baseline: an info notice must auto-dismiss once the 4000ms window elapses. Prove the
      // window actually closes (so the error assertion below isn't vacuously true).
      act(() => {
        useStore.getState().setNotice('Info that should auto-dismiss.');
      });
      await act(async () => {
        // Sonner needs a tick to mount the toast portal.
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByText(/auto-dismiss/)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });
      expect(screen.queryByText(/auto-dismiss/)).not.toBeInTheDocument();

      expect(useStore.getState().notice).toBeNull();

      // Error: created with duration: Infinity, so the same 4500ms advance must not dismiss it.
      act(() => {
        useStore.getState().setNotice('That allocation could not be moved.', 'error');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      const message = screen.getByText(/could not be moved/);
      expect(message.closest('[data-sonner-toast]')).not.toBeNull();

      expect(message.closest('[data-sonner-toast]')).toHaveClass('toast-error');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });
      expect(screen.getByText(/could not be moved/)).toBeInTheDocument();
      expect(useStore.getState().notice?.tone).toBe('error');

      act(() => {
        screen.getByRole('button', { name: 'Close toast' }).click();
      });
      await act(async () => {
        // Let the exit animation finish so onDismiss can clear the notice.
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(useStore.getState().notice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps a WARNING notice on screen past the 4s info window, on the NEUTRAL surface (WCAG 2.2.1)', async () => {
    // A truncation warning must persist until dismissed because it is the only signal that committed work was reduced. It uses neutral styling because the edit succeeded.
    vi.useFakeTimers();
    try {
      renderAppShell({});

      act(() => {
        useStore.getState().setNotice('Work volume was capped at 24h/day.', 'warning');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      const message = screen.getByText(/capped at 24h\/day/);
      const toastEl = message.closest('[data-sonner-toast]');
      expect(toastEl).not.toBeNull();

      expect(toastEl).not.toHaveClass('toast-error');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });
      expect(screen.getByText(/capped at 24h\/day/)).toBeInTheDocument();
      expect(useStore.getState().notice?.tone).toBe('warning');

      act(() => {
        screen.getByRole('button', { name: 'Close toast' }).click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(useStore.getState().notice).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it('rapidly replacing notice A with B leaves B intact (no stale-clear race)', async () => {
    // Dismissing an old Sonner toast can invoke its callback after the replacement is shown. The callback must clear only its own notice; fake timers exercise that ordering before the new notice auto-dismisses.
    vi.useFakeTimers();
    try {
      renderAppShell({});

      // A mounts first (its bridge effect runs, Sonner portals toast A). The swap must dismiss a
      // *real* live toast for the race to exist at all.
      act(() => {
        useStore.getState().setNotice('First notice');
      });
      await act(async () => {
        // Sonner needs a tick to mount the first toast portal.
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByText('First notice')).toBeInTheDocument();

      act(() => {
        useStore.getState().setNotice('Second notice');
      });
      // Pump A's deferred dismiss rAF, then its exit-animation removal, in two steps, Sonner
      // chains those across rAF/flush boundaries, so a single big advance can leave A's node
      // mid-animation. Total here (~250ms post-swap) stays well under the 4000ms auto-dismiss,
      // so B never auto-closes.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });

      // Use synchronous queries after advancing the fake clock; polling queries can stall under paused timers.
      expect(useStore.getState().notice?.message).toBe('Second notice');

      const message = screen.getByText('Second notice');
      expect(message.closest('[data-sonner-toast]')).not.toBeNull();
      expect(screen.queryByText('First notice')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
