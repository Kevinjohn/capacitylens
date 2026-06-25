import * as React from "react"
import { Separator as SeparatorPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// shadcn Separator on the `radix-ui` umbrella. Stock uses bg-border — capacitylens maps --color-border
// to its own --border token (the slate hairline), so it's the correct hairline in both themes;
// kept as-is. Decorative by default (aria role omitted) so it adds a visual rule without injecting
// a spurious separator into the accessibility tree.

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
