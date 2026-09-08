import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHelp } from "../common/ui";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "../ui/card";

function SettingsSectionTitle({
  title,
  collapsible,
  open,
  contentId,
  toggleOpen,
}: {
  title: string;
  collapsible: boolean;
  open: boolean;
  contentId: string;
  toggleOpen: () => void;
}) {
  if (!collapsible) return title;

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={toggleOpen}
    >
      <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", { "rotate-90": open })} />
      {title}
    </button>
  );
}

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
  const expanded = !collapsible || open;

  return (
    <Card
      data-testid={testId}
      className={cn({ "border-danger/40": danger, "py-4": collapsible, "gap-0": collapsible && !open })}
    >
      <CardHeader className="flex items-center gap-0">
        <CardTitle className={cn("flex-1", { "text-danger": danger })}>
          <h2>
            <SettingsSectionTitle
              title={title}
              collapsible={collapsible}
              open={open}
              contentId={contentId}
              toggleOpen={() => setOpen((current) => !current)}
            />
          </h2>
        </CardTitle>
        <CardAction className="self-center">
          <SectionHelp title={title}>{help}</SectionHelp>
        </CardAction>
      </CardHeader>
      {expanded && (
        <CardContent id={contentId} className={cn("flex flex-col gap-3", contentClassName)}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}
