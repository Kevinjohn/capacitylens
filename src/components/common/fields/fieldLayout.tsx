import { FieldLabel } from "../../ui/field";
import { m } from "@/i18n";

export function RequiredFieldLabel({
  label,
  required,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  htmlFor: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {required && (
        <span aria-hidden="true" className="text-danger" title={m.field_required()}>
          *
        </span>
      )}
    </div>
  );
}

/** Place at the bottom of a form to explain the asterisk + red accent convention. */
export function RequiredLegend() {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-danger">*</span> {m.field_required_legend()}
    </p>
  );
}
