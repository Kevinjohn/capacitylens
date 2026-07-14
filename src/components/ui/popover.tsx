import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// shadcn Popover primitives on the `radix-ui` umbrella (same import idiom as button/command).
// The stock content surface uses bg-popover/text-popover-foreground — both EXIST in capacitylens
// (index.css: --popover/--popover-foreground are a white/dark elevated surface), so they're
// AA-safe and kept. Callers that need capacitylens's own elevated panel token can override via
// className (ColorField does, with bg-elevated).
//
// Content defaults to a Portal. A caller that must stay inside a specific DOM subtree (e.g.
// ColorField inside a Dialog, whose capture-phase dismiss listener walks up to [role="dialog"]
// to classify a backdrop press — a portalled popup escapes that subtree) passes `portal={false}`
// to render Content WITHOUT the portal wrapper.

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  portal = true,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  /** When false, render Content inline (no Popover.Portal) so it stays in the trigger's DOM
   *  subtree. Required where a surrounding listener relies on DOM proximity — see header note. */
  portal?: boolean
}) {
  const content = (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "bg-popover text-popover-foreground z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
        className
      )}
      {...props}
    />
  )
  return portal ? <PopoverPrimitive.Portal>{content}</PopoverPrimitive.Portal> : content
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export {
  Popover,
  PopoverContent,
  PopoverAnchor,
}
