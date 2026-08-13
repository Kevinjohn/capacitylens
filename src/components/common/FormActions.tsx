import type { ReactNode } from "react";
import { m } from "@/i18n";
import { Button } from "../ui/button";

/** The standard Cancel/submit actions shared by simple editor forms. */
export function FormActions({
  onCancel,
  submitLabel = m.form_save(),
}: {
  onCancel: () => void;
  submitLabel?: ReactNode;
}) {
  return (
    <>
      <Button size="sm" type="button" variant="outline" onClick={onCancel}>
        {m.form_cancel()}
      </Button>
      <Button size="sm" type="submit">
        {submitLabel}
      </Button>
    </>
  );
}
