import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildBetaExport } from '@capacitylens/shared/data/betaTransfer';
import type { PreparedBetaImport } from '@capacitylens/shared/data/betaTransfer';
import { seed } from '@capacitylens/shared/data/seed';
import { BetaImportPreview } from './BetaImportPreview';

const context = { accountId: 'a-studio', memberResourceLinks: [] };

describe('Beta import preview', () => {
  it('shows supported content and passes stable data only after the user continues', () => {
    const document = buildBetaExport(seed(), {
      accountId: context.accountId,
      completeness: 'full',
    });
    const onPrepared = vi.fn<(prepared: PreparedBetaImport) => void>();
    render(<BetaImportPreview document={document} context={context} onPrepared={onPrepared} />);
    expect(screen.getByRole('status')).toHaveTextContent('Wayne Enterprises');
    expect(screen.getByText(/No data has changed/)).toBeVisible();
    expect(onPrepared).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onPrepared).toHaveBeenCalledWith(expect.objectContaining({ data: document.data }));
  });

  it('previews a full export for a fresh destination company while preserving source IDs', () => {
    const document = buildBetaExport(seed(), {
      accountId: context.accountId,
      completeness: 'full',
    });
    const onPrepared = vi.fn<(prepared: PreparedBetaImport) => void>();
    render(
      <BetaImportPreview
        document={document}
        context={{ accountId: 'new-company', memberResourceLinks: [] }}
        onPrepared={onPrepared}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Wayne Enterprises');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onPrepared).toHaveBeenCalledTimes(1);
    const prepared = onPrepared.mock.calls[0]?.[0];
    expect(prepared?.data.accounts).toEqual([{ ...document.data.accounts[0], id: 'new-company' }]);
    expect(prepared?.data.clients).toEqual(
      document.data.clients.map((row) => ({ ...row, accountId: 'new-company' })),
    );
  });

  it('shows actionable failures without offering preparation and clears stale success on context change', () => {
    const document = buildBetaExport(seed(), {
      accountId: context.accountId,
      completeness: 'full',
    });
    const onPrepared = vi.fn<(prepared: PreparedBetaImport) => void>();
    const { rerender } = render(
      <BetaImportPreview document={document} context={context} onPrepared={onPrepared} />,
    );
    const missingLink = {
      ...context,
      memberResourceLinks: [{ memberId: 'bruce-member', resourceId: 'missing-person' }],
    };
    rerender(
      <BetaImportPreview document={document} context={missingLink} onPrepared={onPrepared} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/resource/i);
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(onPrepared).not.toHaveBeenCalled();
  });

  it('refuses redacted documents before offering preparation', () => {
    const document = buildBetaExport(seed(), {
      accountId: context.accountId,
      completeness: 'redacted',
    });
    render(<BetaImportPreview document={document} context={context} onPrepared={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/full/i);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
