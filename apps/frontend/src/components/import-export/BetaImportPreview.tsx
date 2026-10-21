import { useMemo } from "react";
import { prepareBetaImport } from "@capacitylens/shared/data/betaTransfer";
import { SCOPED_KEYS } from "@capacitylens/shared/types/entities";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { m } from "@/i18n";
import { Button } from "@/components/ui/button";

type ImportContext = Parameters<typeof prepareBetaImport>[1];
type PreparedImport = ReturnType<typeof prepareBetaImport>;

interface BetaImportPreviewProps {
  document: unknown;
  context: ImportContext;
  onPrepared: (prepared: PreparedImport) => void;
}

/** Preview strict beta data without executing a replacement or inferring server authority. */
export function BetaImportPreview({ document, context, onPrepared }: BetaImportPreviewProps) {
  const preview = useMemo(() => {
    try {
      const prepared = prepareBetaImport(document, context);
      const company = prepared.data.accounts[0];
      if (!company) throw new Error("The beta document must contain one company.");
      return { prepared, company };
    } catch (error) {
      return { error: resolveErrorMessage(error) };
    }
  }, [document, context]);

  if (!preview.prepared)
    return (
      <p role="alert" className="break-words text-sm">
        {preview.error}
      </p>
    );
  const prepared = preview.prepared;
  const count = SCOPED_KEYS.reduce((total, key) => total + prepared.data[key].length, 0);
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm">
        {m.data_beta_preview({ count, company: preview.company.name })}
      </p>
      <p className="text-sm text-muted-foreground">{m.data_beta_preview_boundary()}</p>
      <Button type="button" size="sm" onClick={() => onPrepared(prepared)}>
        {m.common_continue()}
      </Button>
    </div>
  );
}
