import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      // CapacityLens edits to the stock shadcn base — same rationale as Input: dropped
      // `bg-transparent`/`dark:bg-input/30` (the field wrapper supplies capacitylens's opaque
      // bg-surface in both themes) and the `aria-invalid:border-destructive
      // aria-invalid:ring-destructive/*` block (one capacitylens danger ring, not two layered).
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
