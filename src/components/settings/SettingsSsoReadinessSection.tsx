import { useState } from "react";
import { m } from "@/i18n";
import { resolveStrictOidcProvider, useAuth } from "../../auth/authContext";
import { useRole } from "../../auth/permissionContext";
import { isServerConfigured } from "../../data/apiConfig";
import { useOfflineState } from "../../data/useOfflineState";
import { useFieldError } from "../../hooks/useFieldError";
import { useStore } from "../../store/useStore";
import { FieldError } from "../ui/field";
import { Button } from "../ui/button";
import { SsoUnlinkConfirmation } from "./MemberConfirmations";
import { SettingsGroup } from "./SettingsGroup";
import { SsoReadinessPanel } from "./SsoReadinessPanel";
import { useTeamDirectory } from "./useTeamDirectory";
import { useWorkspaceReadiness } from "./useWorkspaceReadiness";

function canViewReadiness({
  serverConfigured,
  offlineReadOnly,
  strictProviderId,
  role,
}: {
  serverConfigured: boolean;
  offlineReadOnly: boolean;
  strictProviderId: string | null;
  role: ReturnType<typeof useRole>;
}) {
  return serverConfigured && !offlineReadOnly && strictProviderId !== null && (role === "owner" || role === "admin");
}

function ReadinessDirectoryError({
  error,
  errorId,
  retry,
}: {
  error: string | null;
  errorId: string;
  retry: () => void;
}) {
  return (
    <section data-testid="sso-readiness-section" className="flex flex-col items-start gap-3 p-4 sm:p-6">
      <FieldError id={errorId}>{error}</FieldError>
      <Button type="button" size="sm" variant="outline" onClick={retry}>
        {m.settings_members_retry()}
      </Button>
    </section>
  );
}

function ReadinessLoadError() {
  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 p-3" role="alert" data-testid="sso-readiness-error">
      <h3 className="text-sm font-medium text-danger">{m.settings_sso_readiness_heading()}</h3>
      <p className="text-xs text-danger">{m.settings_sso_readiness_error()}</p>
    </div>
  );
}

function useReadinessActions(activeAccountId: string | null) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const requestAccountId = () => {
    if (!activeAccountId) throw new Error(m.settings_members_err_no_active_account());
    return activeAccountId;
  };
  const withMemberAction = async (key: string, body: (accountId: string) => Promise<void>) => {
    if (busyAction) return;
    const accountId = requestAccountId();
    setBusyAction(key);
    try {
      await body(accountId);
    } finally {
      setBusyAction(null);
    }
  };
  return { busyAction, requestAccountId, withMemberAction };
}

function SettingsSsoReadinessController({
  activeAccountId,
  strictProviderId,
  authMode,
}: {
  activeAccountId: string | null;
  strictProviderId: string | null;
  authMode: ReturnType<typeof useAuth>["authMode"];
}) {
  const setNotice = useStore((state) => state.setNotice);
  const role = useRole();
  const offline = useOfflineState();
  const { error, errorField, errorId, fail, clear } = useFieldError();
  const { busyAction, requestAccountId, withMemberAction } = useReadinessActions(activeAccountId);
  const eligible = canViewReadiness({
    serverConfigured: isServerConfigured(),
    offlineReadOnly: offline.readOnly,
    strictProviderId,
    role,
  });
  const directory = useTeamDirectory({
    enabled: eligible,
    activeAccountId,
    offlineReadOnly: offline.readOnly,
    fail,
  });
  const snapshot = directory.directory.kind === "ready" ? directory.directory.snapshot : null;
  const readiness = useWorkspaceReadiness({
    activeAccountId,
    strictProviderId,
    directory: directory.directory,
    offlineReadOnly: offline.readOnly,
    members: snapshot?.members ?? null,
    refreshDirectory: directory.reload,
    requestAccountId,
    withMemberAction,
    fail,
    setNotice,
  });

  if (!eligible) return null;
  let content;
  if (directory.directory.kind === "error") {
    content = (
      <ReadinessDirectoryError
        error={error}
        errorId={errorId}
        retry={() => {
          clear();
          directory.reload();
        }}
      />
    );
  } else if (!readiness.readinessApplies) {
    return null;
  } else {
    content = (
      <section data-testid="sso-readiness-section" className="flex flex-col gap-3 p-4 sm:p-6">
        {readiness.readinessState.kind === "error" && <ReadinessLoadError />}
        {readiness.readinessState.kind === "ready" && (
          <SsoReadinessPanel
            authMode={authMode}
            readiness={readiness.readinessState.readiness}
            busy={busyAction !== null}
            emailRepair={readiness.emailRepair}
            setEmailRepair={readiness.setEmailRepair}
            error={error}
            errorField={errorField}
            errorId={errorId}
            onCorrectEmail={() => void readiness.correctSsoEmail()}
            onRemoveLink={(member, link) => readiness.setUnlinkRepair({ member, link })}
          />
        )}
        <FieldError id={errorId}>{errorField === null ? error : null}</FieldError>
        <SsoUnlinkConfirmation
          unlinkRepair={readiness.unlinkRepair}
          setUnlinkRepair={readiness.setUnlinkRepair}
          removeIncorrectSsoLink={readiness.removeIncorrectSsoLink}
        />
      </section>
    );
  }
  return (
    <SettingsGroup title={m.settings_sso_readiness_heading()} description={m.settings_sso_readiness_description()}>
      {content}
    </SettingsGroup>
  );
}

/** Reset all company/provider-scoped readiness and repair state at the boundary where that scope changes. */
export function SettingsSsoReadinessSection() {
  const activeAccountId = useStore((state) => state.activeAccountId);
  const { authMode, providers } = useAuth();
  const strictProviderId = resolveStrictOidcProvider(providers)?.id ?? null;
  return (
    <SettingsSsoReadinessController
      key={`${activeAccountId ?? "none"}:${strictProviderId ?? "none"}`}
      activeAccountId={activeAccountId}
      strictProviderId={strictProviderId}
      authMode={authMode}
    />
  );
}
