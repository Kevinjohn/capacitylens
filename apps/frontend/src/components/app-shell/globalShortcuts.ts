import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { m } from '@/i18n';
import { hasOpenDialog, isTextEntryShortcutOwner } from '@/lib/shortcutFilters';
import { isShownByPlanningState } from '@/data/planning/planningNotices';
import { resolveErrorMessage } from '@/lib/errorMessage';
import { useStore } from '@/store/useStore';
import type { StoreState } from '@/store/types';

interface GlobalShortcutsInput {
  redo: StoreState['redoPlanning'];
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  undo: StoreState['undoPlanning'];
}

type PaletteShortcutInput = Pick<GlobalShortcutsInput, 'setPaletteOpen'>;
type HistoryShortcutInput = Pick<GlobalShortcutsInput, 'redo' | 'undo'>;

function handlePaletteShortcut(event: KeyboardEvent, input: PaletteShortcutInput): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return false;
  if (event.isComposing) return true;
  if (useStore.getState().dirtyForm) {
    event.preventDefault();
    if (!event.repeat) useStore.getState().setNotice(m.dialog_unsaved_changes());
    return true;
  }
  if (hasOpenDialog()) return true;
  event.preventDefault();
  if (!event.repeat) input.setPaletteOpen((open) => !open);
  return true;
}

function handleHistoryShortcut(event: KeyboardEvent, input: HistoryShortcutInput) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
  if (event.isComposing || isTextEntryShortcutOwner(event.target) || hasOpenDialog()) return;
  if (useStore.getState().dirtyForm) return;
  event.preventDefault();
  (event.shiftKey ? input.redo() : input.undo()).catch((error: unknown) => {
    if (!isShownByPlanningState(error)) {
      useStore.getState().setNotice(resolveErrorMessage(error), 'error');
    }
  });
}

/** Binds the command-palette and undo/redo keyboard shortcuts. */
export function useGlobalShortcuts(input: GlobalShortcutsInput) {
  const { redo, setPaletteOpen, undo } = input;
  useEffect(() => {
    const dispatchShortcut = (event: KeyboardEvent) => {
      if (!handlePaletteShortcut(event, { setPaletteOpen })) {
        handleHistoryShortcut(event, { redo, undo });
      }
    };
    window.addEventListener('keydown', dispatchShortcut);
    return () => window.removeEventListener('keydown', dispatchShortcut);
  }, [redo, setPaletteOpen, undo]);
}
