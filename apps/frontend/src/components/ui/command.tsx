import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";

import { cn } from "@/lib/cn";

/** Renders the command menu root. */
function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden bg-elevated text-ink",
        className,
      )}
      {...props}
    />
  );
}

/** Renders the command menu search input. */
function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <CommandPrimitive.Input
      data-slot="command-input"
      className={cn(
        "min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Renders the filtered command results. */
function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("overflow-x-hidden overflow-y-auto py-1", className)}
      {...props}
    />
  );
}

/** Renders content when no command results match. */
function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn(
        "py-6 text-center text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Groups related commands with an optional heading. */
function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden text-ink [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint",
        className,
      )}
      {...props}
    />
  );
}

/** Renders an actionable command result. */
function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        // Local colour deviation: selected commands use the paired brand tint and ink. Avoid a separate hover fill because cmdk already changes selection on pointer movement and its paired text colour must change together.
        "relative flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-ink outline-none transition-colors select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-brand-soft data-[selected=true]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
};
