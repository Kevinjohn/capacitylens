import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { ImportPreviewSummary } from '@/data/companyDataRequests';
import { ImportPreview } from './ImportPreview';

const counts = {
  ...(Object.fromEntries(SCOPED_KEYS.map((key) => [key, 0])) as ImportPreviewSummary['counts']),
  resources: 3,
  allocations: 4,
};
const preview: ImportPreviewSummary = { baseRevision: 7, companyName: 'Wayne Enterprises', counts };

describe('Beta import preview', () => {
  it('shows the server summary and continues only when the user asks', () => {
    const onContinue = vi.fn();
    render(<ImportPreview preview={preview} error={null} onContinue={onContinue} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      '7 planning records for Wayne Enterprises',
    );
    expect(screen.getByText(/No data has changed/)).toBeVisible();
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows the server refusal without offering to continue', () => {
    render(
      <ImportPreview
        preview={null}
        error="completeness: only full exports can be imported"
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'completeness: only full exports can be imported',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('waits for the server reply before offering to continue', () => {
    render(<ImportPreview preview={null} error={null} onContinue={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
