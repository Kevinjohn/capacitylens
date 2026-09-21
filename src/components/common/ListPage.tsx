import type { ReactNode } from "react";
import { m } from "@/i18n";
import { AddButton } from "./dialogs";

export function ListPage({
  title,
  addLabel,
  onAdd,
  wide = false,
  children,
}: {
  title: string;
  addLabel?: string;
  onAdd?: () => void;
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={wide ? "mx-auto max-w-4xl p-6" : "mx-auto max-w-3xl p-6"}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{title}</h1>
        {onAdd && <AddButton label={addLabel ?? m.form_add()} onClick={onAdd} />}
      </div>
      {children}
    </div>
  );
}
