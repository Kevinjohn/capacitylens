import { m } from "@/i18n";
import { useState } from "react";
import { accountClient } from "@/account/accountClient";
import { useCan } from "@/auth/permissionContext";
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
    if (!useStore.getState().planningReadyForReplacement()) {
      setNotice("Finish loading or resolving company changes before adding example data.", "error");
      return;
    }
    const release = useStore.getState().suspendPlanningCommands();
    if (!release) {
      setNotice("Finish loading or resolving company changes before adding example data.", "error");
      return;
    }
    const planningContext = useStore.getState().planning.context;
    const ownsContext = () => {
      const state = useStore.getState();
      return state.activeAccountId === accountId && state.planning.context === planningContext;
    };
    let keepBlocked = false;
    setBusy(true);
    try {
      const response = await accountClient.addExampleData(accountId);
      if (!ownsContext()) return;
      if (!response.ok) {
        const unknown = response.status === 408 || response.status >= 500;
        if (unknown) {
          const accepted = await useStore.getState().refreshPlanning({ fresh: true });
          if (!ownsContext()) return;
          keepBlocked = !accepted;
        }
        const message = (await readApiError(response)) ?? m.settings_example_data_failed({ status: response.status });
        if (ownsContext())
          setNotice(keepBlocked ? `${message} ${m.settings_example_data_unknown_reload_required()}` : message, "error");
        return;
      }
      const accepted = await useStore.getState().refreshPlanning({ fresh: true });
      if (!ownsContext()) return;
      keepBlocked = !accepted;
      if (accepted) setNotice(m.settings_example_data_added());
      else setNotice(m.settings_example_data_reload(), "warning");
    } catch (cause) {
      if (!ownsContext()) return;
      const accepted = await useStore
        .getState()
        .refreshPlanning({ fresh: true })
        .catch(() => false);
      if (!ownsContext()) return;
      keepBlocked = !accepted;
      const message = resolveErrorMessage(cause);
      setNotice(keepBlocked ? `${message} ${m.settings_example_data_unknown_reload_required()}` : message, "error");
    } finally {
      if (!keepBlocked) release();
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
