import { useCanEdit } from '@/auth/permissionContext';
import { m } from '@/i18n';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shared add action with its accessible label. */
export function AddButton({
  label,
  onClick,
  testId,
  requiresEdit = true,
}: {
  label: string;
  onClick: () => void;
  testId?: string;
  requiresEdit?: boolean;
}) {
  const canEdit = useCanEdit();
  if (requiresEdit && !canEdit) return null;
  return (
    <Button size="sm" type="button" onClick={onClick} data-testid={testId}>
      <Plus data-icon="inline-start" />
      {label}
    </Button>
  );
}

/** Shared edit action with its accessible label. */
export function EditButton({
  label = m.form_edit(),
  onClick,
  testId,
}: {
  label?: string;
  onClick: () => void;
  testId?: string;
}) {
  if (!useCanEdit()) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
    >
      <Pencil />
    </Button>
  );
}

/** Shared delete action with its accessible label. */
export function DeleteButton({
  label = m.form_delete(),
  onClick,
  testId,
}: {
  label?: string;
  onClick: () => void;
  testId?: string;
}) {
  if (!useCanEdit()) return null;
  return (
    <Button
      type="button"
      variant="danger-soft"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
    >
      <Trash2 />
    </Button>
  );
}
