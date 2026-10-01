import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { useState } from "react";
import { accountClient } from "../../account/accountClient";
import { useAuth } from "../../auth/authContext";
import { useCan } from "../../auth/permissionContext";
import { refreshActiveAccountSlice } from "../../data/persist";
import { useOfflineState } from "../../data/useOfflineState";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { readApiError } from "../../lib/readApiError";
import { useScopedData } from "../../store/useScopedData";
import { useStore } from "../../store/useStore";
import { ConfirmDialog, SwitchField } from "../common/ui";
import { Button } from "../ui/button";
import { SettingsSection } from "./SettingsSection";

import type { useLocalDataActions } from "./useLocalDataActions";

function OfflineDataSection({
  offlineEnabled,
  offlineBusy,
  offlineState,
  toggleOffline,
}: {
  offlineEnabled: boolean;
  offlineBusy: boolean;
  offlineState: ReturnType<typeof useOfflineState>;
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
      {offlineEnabled && offlineState.cacheWriteFailed && (
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

function DeviceDataSection({
  setConfirmingClear,
}: {
  setConfirmingClear: ReturnType<typeof useLocalDataActions>["setConfirmingClear"];
}) {
  return (
    <SettingsSection
      title={m.settings_device_data_heading()}
      description={m.settings_device_scope()}
      help={m.settings_clear_desc_server({ app: APP_NAME })}
      danger
      collapsible
      defaultOpen={false}
    >
      <Button
        size="sm"
        variant="danger-soft"
        data-testid="clear-local-storage"
        onClick={() => setConfirmingClear(true)}
      >
        {m.settings_clear_storage_button()}
      </Button>
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
  confirmingClear,
  setConfirmingClear,
  clearBusy,
  clearLocalStorage,
  toggleOffline,
}: {
  serverMode: boolean;
  authMode: ReturnType<typeof useAuth>["authMode"];
  user: ReturnType<typeof useAuth>["user"];
  offlineEnabled: boolean;
  offlineBusy: boolean;
  offlineState: ReturnType<typeof useOfflineState>;
  confirmingClear: ReturnType<typeof useLocalDataActions>["confirmingClear"];
  setConfirmingClear: ReturnType<typeof useLocalDataActions>["setConfirmingClear"];
  clearBusy: ReturnType<typeof useLocalDataActions>["clearBusy"];
  clearLocalStorage: ReturnType<typeof useLocalDataActions>["clearLocalStorage"];
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
          offlineState={offlineState}
          toggleOffline={toggleOffline}
        />
      )}

      {/* Device data is limited to the opt-in offline snapshot and preferences. Scheduling data is
            server-owned or temporary demo memory, so this action never deletes company data. */}
      <DeviceDataSection setConfirmingClear={setConfirmingClear} />

      {confirmingClear && (
        <ConfirmDialog
          title={m.settings_clear_storage_confirm_title()}
          confirmLabel={m.settings_clear_storage_button()}
          message={m.settings_clear_confirm_server({ app: APP_NAME })}
          busy={clearBusy}
          onConfirm={() => void clearLocalStorage()}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </>
  );
}
