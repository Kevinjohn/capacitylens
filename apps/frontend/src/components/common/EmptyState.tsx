import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useCanEdit } from '@/auth/permissionContext';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

/** Displays guidance when a list has no visible records. */
export function EmptyState({
  children,
  icon,
  description,
  action,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  action?: { label: string; onClick: () => void; icon?: LucideIcon; requiresEdit?: boolean };
}) {
  const canEdit = useCanEdit();
  const showAction = action && (canEdit || !action.requiresEdit);
  const EmptyIcon = icon;
  const ActionIcon = action?.icon;
  return (
    <Empty className="border">
      <EmptyHeader>
        {EmptyIcon && (
          <EmptyMedia variant="icon">
            <EmptyIcon />
          </EmptyMedia>
        )}
        <EmptyTitle>{children}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {showAction && (
        <EmptyContent>
          <Button size="sm" type="button" onClick={action.onClick}>
            {ActionIcon && <ActionIcon data-icon="inline-start" />}
            {action.label}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
