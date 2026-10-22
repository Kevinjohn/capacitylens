import { m } from "@/i18n";
import { useState } from "react";
import { accountClient } from "@/account/accountClient";
import { useCan } from "@/auth/permissionContext";
import { refreshActiveAccountSlice } from "@/data/persist";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { readApiError } from "@/lib/readApiError";
import { useScopedData } from "@/store/useScopedData";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "./SettingsSection";
import { CompanyAnonymiseSection } from "./CompanyAnonymiseSection";

// Ignore the infrastructure Internal client when deciding whether the company has user-created content.
function useCompanyIsEmpty(): boolean {
  const data = useScopedData();
  return (
    data.resources.length === 0 &&
    data.clients.every((client) => client.builtin === true) &&
    data.projects.length === 0 &&
    data.allocations.length === 0
  );
}

function ExampleDataSection() {
  const accountId = useStore((state) => state.activeAccountId);
  const setNotice = useStore((state) => state.setNotice);
  const [busy, setBusy] = useState(false);
  const addExampleData = async () => {
    if (accountId === null || busy) return;
    setBusy(true);
    try {
      const response = await accountClient.addExampleData(accountId);
      if (!response.ok) {
        setNotice(
          (await readApiError(response)) ?? m.settings_example_data_failed({ status: response.status }),
          "error",
        );
        return;
      }
      const outcome = await refreshActiveAccountSlice(accountId);
      if (outcome.kind === "reloaded") setNotice(m.settings_example_data_added());
      else setNotice(m.settings_example_data_reload(), "warning");
    } catch (cause) {
      // Report failed example-data creation so an empty company is not presented as successfully populated.
      setNotice(resolveErrorMessage(cause), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsSection
      title={m.settings_example_data_heading()}
      help={m.settings_example_data_help()}
      testId="settings-example-data"
    >
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          data-testid="add-example-data"
          onClick={() => void addExampleData()}
        >
          {m.settings_example_data_button()}
        </Button>
      </div>
    </SettingsSection>
  );
}

/** Exposes export, import, and local data controls allowed by the current mode. */
export function SettingsDataSection({ serverMode }: { serverMode: boolean }) {
  const canAddExampleData = useCan("manageMembers");
  const companyIsEmpty = useCompanyIsEmpty();
  return (
    <>
      {serverMode && canAddExampleData && companyIsEmpty && <ExampleDataSection />}
      <CompanyAnonymiseSection serverMode={serverMode} />
    </>
  );
}
