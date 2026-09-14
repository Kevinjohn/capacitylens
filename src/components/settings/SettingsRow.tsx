import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionHelp } from "../common/ui";

/** Compact presentation of an existing section inside a Settings group. */
export function SettingsRow({
  title,
  titleContent,
  help,
  description,
  children,
  danger,
  collapsible,
  expanded,
  contentId,
  contentClassName,
  id,
  testId,
}: {
  title: string;
  titleContent: ReactNode;
  help: ReactNode;
  description: string | undefined;
  children: ReactNode;
  danger: boolean;
  collapsible: boolean;
  expanded: boolean;
  contentId: string;
  contentClassName: string | undefined;
  id: string | undefined;
  testId: string | undefined;
}) {
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      data-testid={testId}
      data-slot="settings-row"
      className="min-w-0 scroll-mt-4 px-4 py-4 sm:px-6"
    >
      <div
        className={cn("grid min-w-0 gap-3", { "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-6": !collapsible })}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={cn("min-w-0 flex-1 text-sm font-medium", { "text-danger": danger })}>{titleContent}</h3>
            <SectionHelp title={title}>{help}</SectionHelp>
          </div>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {expanded && (
          <div
            id={contentId}
            className={cn(
              "flex min-w-0 flex-col gap-3 [overflow-wrap:anywhere] [&_[data-segmented-control]]:max-w-full [&_[data-segmented-control]]:flex-wrap [&_[role=radio]]:h-auto [&_[role=radio]]:min-h-7 [&_[role=radio]]:whitespace-normal [&_[role=radio]]:overflow-visible",
              contentClassName,
            )}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
