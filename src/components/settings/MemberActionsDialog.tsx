import type { ReactNode } from "react";
import { m } from "@/i18n";
import { Modal } from "../common/ui";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";

export function MemberActionsDialog({
  memberLabel,
  hasExistingActions,
  busy,
  open,
  onOpenChange,
  children,
}: {
  memberLabel: string;
  hasExistingActions: boolean;
  busy: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}) {
  if (!hasExistingActions) return null;
  return (
    <>
      {!open && (
        <Button
          size="icon-sm"
          variant="outline"
          title={m.settings_member_settings_aria({ member: memberLabel })}
          aria-label={m.settings_member_settings_aria({ member: memberLabel })}
          data-testid="member-menu"
          disabled={busy}
          onClick={() => onOpenChange(true)}
        >
          <Settings />
        </Button>
      )}
      {open && (
        <Modal
          title={m.settings_member_settings_heading()}
          description={memberLabel}
          onClose={() => onOpenChange(false)}
          guardDirty={false}
          footer={
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {m.settings_help_close()}
            </Button>
          }
        >
          <div
            data-testid="member-actions-list"
            role="group"
            aria-label={m.settings_member_settings_heading()}
            className="flex flex-col gap-2"
          >
            {children}
          </div>
        </Modal>
      )}
    </>
  );
}
