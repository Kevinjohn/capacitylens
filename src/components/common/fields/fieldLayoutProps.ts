import { cn } from "@/lib/utils";
import type { ProductFieldLayout } from "./fieldTypes";

const labelControlLayout = "sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] sm:items-center";

// Shared data-attribute + class pair every product field spreads onto its <Field> so the
// opt-in compact "label-control" row layout (see ProductFieldLayout) is applied identically
// everywhere instead of being copy-pasted per field.
export function productFieldLayoutProps(layout: ProductFieldLayout) {
  const compact = layout === "label-control";
  return {
    "data-product-layout": compact ? layout : undefined,
    className: cn(compact && labelControlLayout),
  } as const;
}
