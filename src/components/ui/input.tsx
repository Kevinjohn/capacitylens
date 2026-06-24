import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      // Floaty edits to the stock shadcn base: dropped `bg-transparent`/`dark:bg-input/30`
      // (the field wrappers supply floaty's own bg-surface — opaque in BOTH themes — and
      // dark:bg-input/30 would otherwise win the cascade), and dropped the
      // `aria-invalid:border-destructive aria-invalid:ring-destructive/*` block so the
      // invalid visual is a SINGLE floaty danger ring (fieldAccent's border-danger), not two
      // layered rings. Layout/focus-ring/disabled scaffold is untouched.
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
