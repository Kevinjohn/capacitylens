import type { ReactNode } from "react";
import type { TeamMember } from "../../account/teamAccessClient";
import { m } from "@/i18n";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";

export function MemberActionsDialog({
  member,
  memberLabel,
  hasExistingActions,
  hasResourceActions,
  busy,
  open,
  onOpenChange,
  children,
}: {
  member: TeamMember;
  memberLabel: string;
  hasExistingActions: boolean;
  hasResourceActions: boolean;
  busy: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}) {
  if (!hasExistingActions && !hasResourceActions) return <td className="w-10 py-2 pl-2 text-right" />;
  return (
    <td className="w-10 py-2 pl-2 text-right">
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            title={m.settings_member_settings_aria({ member: memberLabel })}
            aria-label={m.settings_member_settings_aria({ member: memberLabel })}
            data-testid="member-menu"
            disabled={busy}
          >
            <Settings />
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-md" aria-describedby={`member-actions-description-${member.userId}`}>
          <DialogHeader>
            <DialogTitle>{m.settings_member_settings_heading()}</DialogTitle>
            <DialogDescription id={`member-actions-description-${member.userId}`}>{memberLabel}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">{children}</div>
        </DialogContent>
      </Dialog>
    </td>
  );
}
