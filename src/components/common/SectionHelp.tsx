import { useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { m } from "@/i18n";
import { Button } from "../ui/button";
import { Modal } from "./dialogs";

export function SectionHelp({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const helpLabel = m.settings_help_aria({ section: title });

  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={helpLabel}
        title={helpLabel}
        onClick={() => setOpen(true)}
      >
        <CircleHelp aria-hidden="true" />
      </Button>
      {open && (
        <Modal
          title={title}
          guardDirty={false}
          onClose={() => setOpen(false)}
          footer={
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {m.settings_help_close()}
            </Button>
          }
        >
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">{children}</div>
        </Modal>
      )}
    </>
  );
}
