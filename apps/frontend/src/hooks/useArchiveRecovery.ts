import { useCallback, useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { archiveRecovery } from "@capacitylens/shared/domain/lifecycle";
import type { ArchiveRecovery } from "@capacitylens/shared/domain/lifecycle";
import { client, scopeQueryKey } from "@/api/queryClient";
import { useAuth } from "@/auth/authContext";
import { useCan, useRole, usePermissionStatus } from "@/auth/permissionContext";
import { isServerConfigured } from "@/data/apiConfig";
import { subscribeToInactiveDataChanges } from "@/data/inactiveDataEvents";
import { getMasqueradeContextToken } from "@/auth/masqueradeContext";
import { useInactiveScopedData } from "@/store/useScopedData";
import { useStore } from "@/store/useStore";
import { m } from "@/i18n";
import { resolveErrorMessage } from "@/lib/errorMessage";

function hasCurrentPlanningAccess(
  accessKey: string | null,
  principalId: string | undefined,
  role: string | null,
): boolean {
  if (!accessKey || !principalId || !role) return false;
  try {
    const access: unknown = JSON.parse(accessKey);
    return (
      Array.isArray(access) &&
      access[0] === principalId &&
      access[1] === principalId &&
      access[2] === role &&
      access[3] === true
    );
  } catch {
    // Unrecognised authority keys cannot establish permission for an inactive-data request.
    return false;
  }
}

/** Reads recovery identities with a fresh cache fence for every principal/access transition. */
export function useArchiveRecovery() {
  const server = isServerConfigured();
  const { user } = useAuth();
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const mayWrite = useCan("write");
  const accountId = useStore((state) => state.activeAccountId);
  const planning = useStore((state) => state.planning);
  const masquerade = useStore((state) => state.masquerade);
  const localData = useInactiveScopedData();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  useEffect(
    () =>
      subscribeToInactiveDataChanges((companyId) => {
        if (companyId === useStore.getState().activeAccountId) reload();
      }),
    [reload],
  );
  const enabled =
    mayWrite &&
    !!accountId &&
    (!server ||
      (!!user &&
        permissionStatus === "resolved" &&
        hasCurrentPlanningAccess(planning.accessKey, user.id, role) &&
        planning.context?.companyId === accountId &&
        planning.canWrite &&
        planning.status === "ready"));
  const scope = {
    principalId: user?.id ?? null,
    accountId,
    masqueradeGeneration: masquerade.kind === "inactive" ? 0 : masquerade.generation,
  };
  const signature = JSON.stringify([
    scope,
    role,
    permissionStatus,
    enabled,
    planning.accessKey,
    planning.revision,
    reloadKey,
  ]);
  const [fence, setFence] = useState({ signature, context: planning.context, epoch: 0 });
  const transitioned = fence.signature !== signature || fence.context !== planning.context;
  const epoch = transitioned ? fence.epoch + 1 : fence.epoch;
  if (transitioned) setFence({ signature, context: planning.context, epoch });
  const instance = useId();
  const contextToken = getMasqueradeContextToken();
  const query = useQuery<ArchiveRecovery>({
    queryKey: scopeQueryKey(scope, [
      "archive-recovery",
      instance,
      epoch,
      role,
      planning.accessKey,
      planning.revision,
      reloadKey,
    ]),
    enabled: server && enabled,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const response = await client.request("api.planning.archive", {
        params: { accountId: accountId ?? "" },
        signal,
        headers: { "X-Masquerade-Context": contextToken ?? "" },
      });
      if (!response || response.accountId !== accountId) throw new Error(m.settings_archived_err_incomplete());
      return response;
    },
  });
  if (!enabled) return { data: null, error: null, reload };
  if (!server) return { data: archiveRecovery(localData, accountId, role ?? "owner"), error: null, reload };
  return {
    data: query.isError ? null : (query.data ?? null),
    error: query.error ? resolveErrorMessage(query.error) : null,
    reload,
  };
}
