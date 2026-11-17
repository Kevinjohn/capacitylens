import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SCOPED_KEYS } from '@capacitylens/shared/types/entities';
import type { TransferPreview } from '@/data/companyDataRequests';
import { BetaImportPreview } from './BetaImportPreview';

const counts = {
  ...(Object.fromEntries(SCOPED_KEYS.map((key) => [key, 0])) as TransferPreview['counts']),
  resources: 3,
  allocations: 4,
};
const preview: TransferPreview = { baseRevision: 7, companyName: 'Wayne Enterprises', counts };

describe('Beta import preview', () => {
  it('shows the server summary and continues only when the user asks', () => {
    const onContinue = vi.fn();
    render(<BetaImportPreview preview={preview} error={null} onContinue={onContinue} />);
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
      <BetaImportPreview
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
    render(<BetaImportPreview preview={null} error={null} onContinue={vi.fn()} />);
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
