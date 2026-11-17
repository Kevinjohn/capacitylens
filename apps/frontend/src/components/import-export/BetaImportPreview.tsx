import type { TransferPreview } from '@/data/companyDataRequests';
import { m } from '@/i18n';
import { Button } from '@/components/ui/button';

interface BetaImportPreviewProps {
  /** The server's description of the document, or null until it arrives or when it was refused. */
  preview: TransferPreview | null;
  /** The server's reason for refusing the document. */
  error: string | null;
  onContinue: () => void;
}

/** Renders the server's import preview without executing a replacement or validating the document. */
export function BetaImportPreview({ preview, error, onContinue }: BetaImportPreviewProps) {
  if (error !== null) {
    return (
      <p role="alert" className="break-words text-sm">
        {error}
      </p>
    );
  }
  if (!preview) return <p role="status">{m.data_importing_body()}</p>;
  const count = Object.values(preview.counts).reduce((total, rows) => total + rows, 0);
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm">
        {m.data_beta_preview({ count, company: preview.companyName })}
      </p>
      <p className="text-sm text-muted-foreground">{m.data_beta_preview_boundary()}</p>
      <Button type="button" size="sm" onClick={onContinue}>
        {m.common_continue()}
      </Button>
    </div>
  );
}
