import { useEffect, useId, useRef } from "react";
import { APP_NAME } from "@capacitylens/shared/brand";
import { m } from "@/i18n";
import { Button } from "./ui/button";

export function ProductOrientation({ onDismiss }: { onDismiss: () => void }) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="border-b border-line bg-surface px-4 py-4 sm:px-6"
      data-testid="product-orientation"
    >
      <div className="max-w-3xl">
        <h2 ref={headingRef} tabIndex={-1} id={headingId} className="text-base font-semibold text-ink outline-none">
          {m.product_orientation_heading({ app: APP_NAME })}
        </h2>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          <p>{m.product_orientation_summary({ app: APP_NAME })}</p>
          <p>{m.product_orientation_schedule()}</p>
          <p>{m.product_orientation_boundary({ app: APP_NAME })}</p>
        </div>
        <Button className="mt-3" size="sm" onClick={onDismiss}>
          {m.product_orientation_dismiss()}
        </Button>
      </div>
    </section>
  );
}
