import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// shadcn Tooltip primitives on the `radix-ui` umbrella. The stock content uses bg-primary
// (shadcn's slate) + text-primary-foreground; capacitylens's --primary is the slate brand and would
// clash with the blue identity, so the content is restyled with capacitylens's elevated-surface
// tokens (bg-elevated/text-ink/ring-line/shadow-pop) — the SAME treatment as the hand-rolled
// nav-rail hover label in AppShell — which is AA-safe in both themes. A tooltip is supplementary:
// the trigger keeps its own aria-label so the tooltip is never the sole accessible name.

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

// Provider-less Root, for collections that hoist a SINGLE shared TooltipProvider above many
// tooltips (e.g. the scheduler grid over its virtualised bars) rather than paying the provider's
// per-instance machinery on every one. Callers using this MUST render under a <TooltipProvider>.
function TooltipRoot({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 4,
  // Default-true so every existing tooltip keeps its arrow; a rich-card caller (the scheduler
  // allocation popover) opts out to match the old arrow-less card.
  showArrow = true,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & { showArrow?: boolean }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-elevated text-ink ring-1 ring-line shadow-pop z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-2 py-1 text-xs font-medium text-balance",
          className
        )}
        {...props}
      >
        {children}
        {showArrow && (
          <TooltipPrimitive.Arrow className="bg-elevated fill-elevated z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        )}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipRoot, TooltipTrigger, TooltipContent, TooltipProvider }
