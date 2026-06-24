import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// shadcn Tabs on the `radix-ui` umbrella. DEFERRED for this phase (not applied to any surface yet;
// it would touch the settings e2e and needs this override audited live) but present in ui/ so it's
// ready — and pre-tuned for floaty's tokens so the override doesn't get forgotten later.
//
// THE OVERRIDE that mattered: stock shadcn TabsList is `bg-muted text-muted-foreground` and the
// active TabsTrigger goes `bg-background`. In floaty, --color-muted is a slate INK (a dark text
// colour, NOT a light surface) — so a stock TabsList renders as a DARK bar with low-contrast text,
// failing AA. So TabsList here uses floaty's own elevated/hairline surface (bg-elevated + border)
// with text-muted for the *inactive* label, and the active TabsTrigger gets the brand fill
// (bg-brand-soft + text-ink) — AA-safe in light AND dark, matching the toolbar's zoom toggle look.

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // Floaty tokens, NOT shadcn's bg-muted/text-muted-foreground (see header note): an
        // elevated rail with a hairline border + muted inactive text.
        "bg-elevated text-muted border border-line inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Active tab = brand-soft fill + full ink (AA in both themes); inactive inherits the
        // list's text-muted. Replaces shadcn's data-[state=active]:bg-background.
        "data-[state=active]:bg-brand-soft data-[state=active]:text-ink focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
