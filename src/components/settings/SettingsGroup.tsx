import { useId, type ReactNode } from "react";
import { SettingsGroupContext } from "./settingsGroupContext";

export function SettingsGroup({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description: string;
  children: ReactNode;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-labelledby={headingId}
      className="min-w-0 scroll-mt-4 rounded-xl border bg-card text-card-foreground"
    >
      <header className="border-b px-4 py-4 sm:px-6">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>
      <SettingsGroupContext.Provider value={true}>
        <div className="divide-y">{children}</div>
      </SettingsGroupContext.Provider>
    </section>
  );
}
