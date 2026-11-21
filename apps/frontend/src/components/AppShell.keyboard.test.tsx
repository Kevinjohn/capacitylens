import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import { screen, act, waitFor } from '@testing-library/react';
import { PlanningCacheError } from '@/data/planning/planningErrors';
import { useStore } from '@/store/useStore';
import { setUpAppShellTests, renderAppShell } from './AppShellTestKit';

const i18nMocks = vi.hoisted(() => ({ syncLocaleFromCompany: vi.fn() }));
vi.mock('@/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n')>()),
  syncLocaleFromCompany: i18nMocks.syncLocaleFromCompany,
}));

setUpAppShellTests(i18nMocks.syncLocaleFromCompany);

describe('AppShell undo/redo keyboard', () => {
  // The shortcuts drive the planning cache's typed history.
  function withPlanningHistorySpies(run: (spies: { undo: Mock; redo: Mock }) => void) {
    const { undoPlanning, redoPlanning } = useStore.getState();
    const spies = { undo: vi.fn(async () => true), redo: vi.fn(async () => true) };
    useStore.setState({ undoPlanning: spies.undo, redoPlanning: spies.redo });
    try {
      run(spies);
    } finally {
      useStore.setState({ undoPlanning, redoPlanning });
    }
  }

  it('⌘Z undoes through planning history, but is IGNORED while a form is dirty', () => {
    useStore.getState().setHydrated(true);
    renderAppShell({});

    withPlanningHistorySpies((spies) => {
      // A dirty form owns ⌘Z, undoing would revert the data behind the unsaved form (the
      // focus check alone misses non-text controls like a <select>), so it must be ignored.
      act(() => {
        useStore.getState().setDirtyForm(true);
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
      });
      expect(spies.undo).not.toHaveBeenCalled();

      act(() => {
        useStore.getState().setDirtyForm(false);
      });
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
      });
      expect(spies.undo).toHaveBeenCalledOnce();

      act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true }),
        );
      });
      expect(spies.redo).toHaveBeenCalledOnce();
    });
  });

  it('surfaces a rejected shortcut as an error notice unless planning state already shows it', async () => {
    useStore.getState().setHydrated(true);
    renderAppShell({});
    const { undoPlanning } = useStore.getState();
    try {
      // Swap the action inside act so the shortcut listener re-binds before the key press.
      act(() =>
        useStore.setState({ undoPlanning: () => Promise.reject(new Error('History is corrupt')) }),
      );
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
      });
      await waitFor(() =>
        expect(useStore.getState().notice).toEqual({
          message: 'History is corrupt',
          tone: 'error',
        }),
      );

      act(() => useStore.getState().setNotice(null));
      // A stale revision is shown by refetching server state, so it must not also raise a toast.
      act(() =>
        useStore.setState({
          undoPlanning: () =>
            Promise.reject(new PlanningCacheError('The schedule changed.', 'STALE_REVISION', 409)),
        }),
      );
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(useStore.getState().notice).toBeNull();
    } finally {
      useStore.setState({ undoPlanning });
    }
  });

  it('ignores undo and redo while a clean modal has focus on a non-text control', () => {
    useStore.getState().setHydrated(true);
    renderAppShell({});

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('data-state', 'open');
    const button = document.createElement('button');
    modal.append(button);
    document.body.append(modal);

    try {
      withPlanningHistorySpies((spies) => {
        act(() => {
          button.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }),
          );
        });
        act(() => {
          button.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'z',
              metaKey: true,
              shiftKey: true,
              bubbles: true,
            }),
          );
        });
        expect(spies.undo).not.toHaveBeenCalled();
        expect(spies.redo).not.toHaveBeenCalled();
      });
    } finally {
      modal.remove();
    }
  });
});

describe('AppShell command palette dirty-form guard', () => {
  it('Ctrl+K with dirtyForm=true shows the unsaved-changes notice and does NOT open the palette', async () => {
    useStore.getState().setHydrated(true);
    renderAppShell({});

    act(() => {
      useStore.getState().setDirtyForm(true);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });

    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    // Sonner mounts notices through its portal asynchronously, so wait for the rendered message.
    expect(
      await screen.findByText(
        'You have unsaved changes — use Cancel or Save to close this dialog.',
      ),
    ).toBeInTheDocument();
  });
  it('Ctrl+K with dirtyForm=false opens the palette', () => {
    useStore.getState().setHydrated(true);
    renderAppShell({});

    act(() => {
      useStore.getState().setDirtyForm(false);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });

    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });
  it('leaves Cmd/Ctrl+K to an existing modal', () => {
    renderAppShell({});
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('data-state', 'open');
    document.body.appendChild(modal);
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    try {
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
    } finally {
      modal.remove();
    }
  });
  it('ignores Cmd/Ctrl+K during IME composition', () => {
    renderAppShell({});
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      isComposing: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });
  it('keeps the palette open when the Ctrl+K keydown repeats', () => {
    renderAppShell({});

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, repeat: true }));
    });

    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });
  it('closes the open palette with a second Ctrl+K', () => {
    renderAppShell({});

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });
  it('leaves Ctrl+K to a later modal even while the palette is open', () => {
    renderAppShell({});
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    });
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('data-state', 'open');
    document.body.appendChild(modal);
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    try {
      act(() => {
        window.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    } finally {
      modal.remove();
    }
  });
});
