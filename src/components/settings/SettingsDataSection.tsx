import { m } from "@/i18n";
import { APP_NAME } from "@capacitylens/shared/brand";
import { useAuth } from "../../auth/authContext";
import { useOfflineState } from "../../data/useOfflineState";
import { ConfirmDialog, SwitchField } from "../common/ui";
import { Button } from "../ui/button";
import { SettingsSection } from "./SettingsSection";

import type { useLocalDataActions } from "./useLocalDataActions";
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
  return (
    <>
      {serverMode && authMode !== "off" && user && (
        <SettingsSection title={m.settings_offline_heading()} help={m.settings_offline_description()}>
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
      )}

      {/* Device data is limited to the opt-in offline snapshot and preferences. Scheduling data is
            server-owned or temporary demo memory, so this action never deletes company data. */}
      <SettingsSection
        title={m.settings_device_data_heading()}
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
