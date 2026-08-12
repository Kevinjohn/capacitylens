import { useId, useState, type ReactNode } from "react";
import { ChevronRight, CircleHelp } from "lucide-react";
import { m } from "@/i18n";
import { cn } from "@/lib/utils";
import { Modal } from "../common/ui";
import { Button } from "../ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../ui/card";

export function SettingsSection({
  title,
  help,
  children,
  danger = false,
  collapsible = false,
  defaultOpen = true,
  testId,
  contentClassName,
}: {
  title: string;
  help: ReactNode;
  children: ReactNode;
  danger?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  testId?: string;
  contentClassName?: string;
}) {
  const contentId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const expanded = !collapsible || open;
  const helpLabel = m.settings_help_aria({ section: title });

  return (
    <>
      <Card
        data-testid={testId}
        className={cn(danger && "border-danger/40", collapsible && "py-4", collapsible && !open && "gap-0")}
      >
        <CardHeader className="flex items-center gap-0">
          <CardTitle className={cn("flex-1", danger && "text-danger")}>
            <h2>
              {collapsible ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={open}
                  aria-controls={contentId}
                  onClick={() => setOpen((current) => !current)}
                >
                  <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-90")} />
                  {title}
                </button>
              ) : (
                title
              )}
            </h2>
          </CardTitle>
          <CardAction className="self-center">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={helpLabel}
              title={helpLabel}
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp aria-hidden="true" />
            </Button>
          </CardAction>
        </CardHeader>
        {expanded && (
          <CardContent id={contentId} className={cn("flex flex-col gap-3", contentClassName)}>
            {children}
          </CardContent>
        )}
      </Card>
      {helpOpen && (
        <Modal
          title={title}
          guardDirty={false}
          onClose={() => setHelpOpen(false)}
          footer={
            <Button type="button" variant="outline" onClick={() => setHelpOpen(false)}>
              {m.settings_help_close()}
            </Button>
          }
        >
          <div className="flex flex-col gap-3 text-sm text-muted-foreground">{help}</div>
        </Modal>
      )}
    </>
  );
}
