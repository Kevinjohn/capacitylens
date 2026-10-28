import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRouteUrl } from "@/api/queryClient";
import { apiFetch } from "@/data/requestTimeout";
import { readApiError } from "@/lib/readApiError";
import { MAX_NAME_LENGTH } from "@capacitylens/shared/lib/strings";
import { m } from "@/i18n";

/** Collects the only company setup choice after native identity authentication. */
export function CompanySetup({
  onCreated,
  onConflict,
  onSignOut,
}: {
  onCreated: () => Promise<void> | void;
  onConflict: () => Promise<boolean>;
  onSignOut: () => Promise<void> | void;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(apiRouteUrl("api.installation.company", {}), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (response.status === 409 && (await onConflict())) return;
      if (!response.ok) throw new Error((await readApiError(response)) ?? m.company_setup_failed());
      await onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : m.company_setup_failed());
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-6" data-testid="company-setup">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h1 className="text-2xl font-semibold">{m.company_setup_title()}</h1>
        <p className="text-sm text-muted-foreground">{m.company_setup_intro()}</p>
        <div className="space-y-2">
          <Label htmlFor={id}>{m.company_setup_name_label()}</Label>
          <Input
            id={id}
            data-testid="company-setup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_NAME_LENGTH}
            required
            autoComplete="organization"
            disabled={busy}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button data-testid="company-setup-submit" type="submit" disabled={busy || !name.trim()} className="w-full">
          {busy ? m.company_setup_creating() : m.company_setup_create()}
        </Button>
        <Button type="button" variant="link" disabled={busy} onClick={() => void onSignOut()} className="w-full">
          {m.company_setup_sign_out()}
        </Button>
      </form>
    </main>
  );
}
