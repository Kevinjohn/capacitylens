import { m } from "@/i18n";
import { useState } from "react";
import { accountClient } from "@/account/accountClient";
import type { useAuth } from "@/auth/authContext";
import { useCan } from "@/auth/permissionContext";
import { refreshActiveAccountSlice } from "@/data/persist";
import type { useOfflineState } from "@/data/useOfflineState";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { readApiError } from "@/lib/readApiError";
import { useScopedData } from "@/store/useScopedData";
import { useStore } from "@/store/useStore";
import { SwitchField } from "@/components/common/ui";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "./SettingsSection";

import type { useLocalDataActions } from "./useLocalDataActions";

function OfflineDataSection({
  offlineEnabled,
  offlineBusy,
  cacheWriteFailed,
  toggleOffline,
}: {
  offlineEnabled: boolean;
  offlineBusy: boolean;
  cacheWriteFailed: boolean;
  toggleOffline: ReturnType<typeof useLocalDataActions>["toggleOffline"];
}) {
  return (
    <SettingsSection
      title={m.settings_offline_heading()}
      help={m.settings_offline_description()}
      description={m.settings_device_scope()}
    >
      <SwitchField
        label={m.settings_offline_toggle()}
        checked={offlineEnabled}
        // The handler derives the next value itself (it also has to cache/roll back for it).
        onChange={() => toggleOffline()}
        disabled={offlineBusy}
      />
      {offlineEnabled && cacheWriteFailed && (
        <p role="status" className="text-sm text-danger">
          {m.settings_offline_write_failed()}
        </p>
      )}
    </SettingsSection>
  );
}

/** True while the company holds nothing a person put there. The built-in Internal client is
 * infrastructure every company has, so it does not count. */
function useCompanyIsEmpty(): boolean {
  const data = useScopedData();
  return (
    data.resources.length === 0 &&
    data.clients.every((client) => client.builtin === true) &&
    data.projects.length === 0 &&
    data.allocations.length === 0
  );
}

/** Offered only to a company admin, only while the company is empty; the server enforces both. */
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

export function SettingsDataSection({
  serverMode,
  authMode,
  user,
  offlineEnabled,
  offlineBusy,
  offlineState,
  toggleOffline,
}: {
  serverMode: boolean;
  authMode: ReturnType<typeof useAuth>["authMode"];
  user: ReturnType<typeof useAuth>["user"];
  offlineEnabled: boolean;
  offlineBusy: boolean;
  offlineState: ReturnType<typeof useOfflineState>;
  toggleOffline: ReturnType<typeof useLocalDataActions>["toggleOffline"];
}) {
  const canAddExampleData = useCan("manageMembers");
  const companyIsEmpty = useCompanyIsEmpty();
  return (
    <>
      {serverMode && canAddExampleData && companyIsEmpty && <ExampleDataSection />}

      {serverMode && authMode !== "off" && user && (
        <OfflineDataSection
          offlineEnabled={offlineEnabled}
          offlineBusy={offlineBusy}
          cacheWriteFailed={offlineState.cacheWriteFailed}
          toggleOffline={toggleOffline}
        />
      )}
    </>
  );
}
