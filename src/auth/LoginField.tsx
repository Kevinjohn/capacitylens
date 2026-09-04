import { type ComponentProps } from "react";
import { Field, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";

export function LoginField({ id, label, ...props }: ComponentProps<typeof Input> & { id: string; label: string }) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} {...props} />
    </Field>
  );
}
