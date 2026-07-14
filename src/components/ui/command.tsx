import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"

import { cn } from "@/lib/utils"

// CapacityLens rebuild of the shadcn `command` primitives (cmdk). The generated file shipped a
// `CommandDialog` wrapper that imports `@/components/ui/dialog` — deleted in the dialog phase —
// so that export (and its Dialog/DialogContent import) is intentionally removed. Only the bare
// cmdk primitives remain, restyled with CapacityLens tokens (bg-elevated / text-ink / text-faint /
// bg-brand-soft) rather than the shadcn defaults (bg-popover / bg-accent /
// text-muted-foreground), which don't exist in capacitylens and risk the AA / --color-muted ink issue.
// The outer backdrop, panel chrome, search-icon and "esc" kbd live in CommandPalette.tsx; these
// stay layout-light so the palette owns that frame.

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
  )
}

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
  )
}

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
  )
}

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
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        // Active (cmdk sets data-[selected=true] on pointer-enter AND keyboard nav) → the
        // AA-validated brand-soft tint + ink. Deliberately NO `hover:bg-canvas`: cmdk already
        // activates the hovered row, so a CSS :hover canvas tint would only ever flash a
        // `bg-canvas` row whose sublabel is still `text-faint` (4.43:1 on canvas — fails AA),
        // whereas the active path swaps the sublabel to `text-muted`. No shadcn bg-accent.
        "relative flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-ink outline-none transition-colors select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-brand-soft data-[selected=true]:text-ink",
        className,
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
}
