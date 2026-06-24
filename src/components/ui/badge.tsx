import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// shadcn Badge on `radix-ui`'s Slot (asChild support). Stock variants use shadcn's --primary /
// --secondary / --destructive — floaty's --primary is the slate brand and --destructive solid red
// fails AA against white in floaty's dark token, so the brand/danger variants instead bind to
// floaty's own AA-tuned SOFT tokens (bg-brand-soft + brand-soft-ink; bg-danger-soft + danger-soft-ink)
// — a quiet chip fill that's AA-safe in both themes. (NB: ui/button.tsx is stock — bg-primary /
// bg-destructive — so this is a Badge-specific floaty treatment, not Button parity.) `secondary`
// keeps shadcn's bg-secondary (a neutral chip, AA-safe in both themes). `warn` is floaty's amber
// chip (the parked TemporaryTag look).

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-brand-soft text-brand-soft-ink",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        danger: "border-transparent bg-danger-soft text-danger-soft-ink",
        warn: "border-warn/40 bg-warn/10 text-ink",
        outline: "text-ink border-line",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
