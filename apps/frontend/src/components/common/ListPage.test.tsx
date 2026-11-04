import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListPage } from './ui';
import { useStore } from '@/store/useStore';
import { emptyAppData } from '@capacitylens/shared/types/entities';

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe('ListPage', () => {
  it('renders the page title', () => {
    render(<ListPage title="My Page" />);
    expect(screen.getByRole('heading', { name: 'My Page' })).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <ListPage title="Page">
        <p>Child content</p>
      </ListPage>,
    );
    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('renders Add button with default label when onAdd is provided', () => {
    const onAdd = vi.fn();
    render(<ListPage title="Page" onAdd={onAdd} />);
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('calls onAdd when the Add button is clicked', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ListPage title="Page" onAdd={onAdd} />);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('uses a custom addLabel', () => {
    const onAdd = vi.fn();
    render(<ListPage title="Page" onAdd={onAdd} addLabel="New item" />);
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument();
  });

  it('does not render an Add button when onAdd is not provided', () => {
    render(<ListPage title="Page" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
