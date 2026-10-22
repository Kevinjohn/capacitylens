import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_BASE } from "@/data/apiConfig";
import { apiFetch } from "@/data/requestTimeout";
import { readApiError } from "@/lib/readApiError";

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
      const response = await apiFetch(`${API_BASE}/api/installation/company`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (response.status === 409 && (await onConflict())) return;
      if (!response.ok) throw new Error((await readApiError(response)) ?? "Company setup failed. Try again.");
      await onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Company setup failed. Try again.");
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
        <h1 className="text-2xl font-semibold">Set up your company</h1>
        <p className="text-sm text-muted-foreground">Create your company to start scheduling. You will be its Owner.</p>
        <div className="space-y-2">
          <Label htmlFor={id}>Company name</Label>
          <Input
            id={id}
            data-testid="company-setup-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
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
          {busy ? "Creating company…" : "Create company"}
        </Button>
        <Button type="button" variant="link" disabled={busy} onClick={() => void onSignOut()} className="w-full">
          Sign out
        </Button>
      </form>
    </main>
  );
}
