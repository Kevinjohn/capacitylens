import { loadPlanningData } from '@/test/fixtures';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { EmptyState } from './ui';
import { EmptyDescription } from '@/components/ui/empty';
import { useStore } from '@/store/useStore';
import { emptyAppData } from '@capacitylens/shared/types/entities';

beforeEach(() => {
  loadPlanningData(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe('EmptyState', () => {
  it('renders children text', () => {
    render(<EmptyState>No items yet.</EmptyState>);
    expect(screen.getByText('No items yet.')).toBeInTheDocument();
  });

  it('keeps EmptyDescription paragraph props and refs aligned with its DOM element', () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<EmptyDescription ref={ref}>Nothing scheduled.</EmptyDescription>);

    expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
    expect(ref.current?.tagName).toBe('P');
  });
});
