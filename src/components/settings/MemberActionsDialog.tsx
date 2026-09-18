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
  busy,
  open,
  onOpenChange,
  children,
}: {
  member: TeamMember;
  memberLabel: string;
  hasExistingActions: boolean;
  busy: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}) {
  if (!hasExistingActions) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          size="icon-sm"
          variant="outline"
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
  );
}
