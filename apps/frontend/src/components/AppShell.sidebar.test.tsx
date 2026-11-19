import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent, within } from '@testing-library/react';
import { useStore } from '@/store/useStore';
import { stubMatchMedia } from '@/test/stubMatchMedia';
import { setUpAppShellTests, renderAppShell } from './AppShell.testSupport';

const i18nMocks = vi.hoisted(() => ({ syncLocaleFromCompany: vi.fn() }));
vi.mock('@/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n')>()),
  syncLocaleFromCompany: i18nMocks.syncLocaleFromCompany,
}));

setUpAppShellTests(i18nMocks.syncLocaleFromCompany);

describe('AppShell sidebar collapse', () => {
  beforeEach(() => {
    act(() => {
      useStore.getState().setSidebarOpen(true);
    });
    localStorage.removeItem('capacitylens/sidebar');
  });

  it('defaults open (jsdom has no matchMedia → large-screen default): links + collapse toggle', () => {
    renderAppShell({});

    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument();
    const toggle = within(screen.getByTestId('app-sidebar')).getByRole('button', {
      name: 'Collapse menu',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
  it('reports the mobile sheet state and next action from the top-bar trigger', () => {
    stubMatchMedia(() => true);
    sessionStorage.setItem('capacitylens/rotateHintDismissed', '1');
    renderAppShell({});

    const trigger = within(screen.getByRole('main')).getByRole('button', { name: 'Expand menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAccessibleName('Collapse menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
  it('collapsing keeps the navigation links usable and persists the choice', () => {
    renderAppShell({});

    act(() => {
      within(screen.getByTestId('app-sidebar'))
        .getByRole('button', { name: 'Collapse menu' })
        .click();
    });

    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-state', 'collapsed');
    expect(
      within(screen.getByTestId('app-sidebar')).getByRole('button', { name: 'Expand menu' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(localStorage.getItem('capacitylens/sidebar')).toBe('closed');
  });
  it('collapsed destinations remain real links instead of reopening the menu', () => {
    renderAppShell({});
    act(() => {
      useStore.getState().setSidebarOpen(false);
    });

    expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects');
    expect(screen.getByTestId('app-sidebar')).toHaveAttribute('data-state', 'collapsed');
    expect(localStorage.getItem('capacitylens/sidebar')).toBe('closed');
  });
  it('nav links carry icons without changing their accessible names', () => {
    renderAppShell({});
    const link = screen.getByRole('link', { name: 'Projects' });
    expect(link.querySelector('svg')).not.toBeNull();
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
  it('toggles with Cmd/Ctrl+B and prevents the browser shortcut outside guarded contexts', () => {
    renderAppShell({});
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(useStore.getState().sidebarOpen).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });
  it.each([
    ['input', 'input'],
    ['textarea', 'textarea'],
    ['select', 'select'],
    ['editable content', 'div'],
  ] as const)('leaves Cmd/Ctrl+B to %s', (_label, tagName) => {
    renderAppShell({});
    const target = document.createElement(tagName);
    if (tagName === 'div') target.setAttribute('contenteditable', 'true');
    document.body.append(target);
    try {
      const event = new KeyboardEvent('keydown', {
        key: 'b',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      act(() => {
        target.dispatchEvent(event);
      });

      expect(useStore.getState().sidebarOpen).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      target.remove();
    }
  });
  it('ignores Cmd/Ctrl+B during IME composition', () => {
    renderAppShell({});
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(useStore.getState().sidebarOpen).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  });
  it('ignores Cmd/Ctrl+B while a modal is open', () => {
    renderAppShell({});
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('data-state', 'open');
    document.body.append(modal);
    const event = new KeyboardEvent('keydown', {
      key: 'b',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    try {
      act(() => {
        window.dispatchEvent(event);
      });

      expect(useStore.getState().sidebarOpen).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      modal.remove();
    }
  });
});
