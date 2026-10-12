import { cn } from "@/lib/cn";
import type { ProductFieldLayout } from "./fieldTypes";

const labelControlLayout = "sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:items-center";

// Product fields share one layout attribute and class contract so compact label/control placement stays consistent.
/** Maps a field layout choice to shared label and control placement. */
export function buildProductFieldLayoutProps(layout: ProductFieldLayout) {
  const compact = layout === "label-control";
  return {
    "data-product-layout": compact ? layout : undefined,
    className: cn(compact && labelControlLayout),
  } as const;
}
