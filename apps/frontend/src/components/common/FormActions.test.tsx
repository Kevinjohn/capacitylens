import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormActions } from './ui';
import { useStore } from '@/store/useStore';
import { emptyAppData } from '@capacitylens/shared/types/entities';

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe('FormActions', () => {
  it('renders the standard actions and supports a submit-label override', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <form>
        <FormActions onCancel={onCancel} submitLabel="Create" />
      </form>,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Create' })).toHaveAttribute('type', 'submit');
  });
});
