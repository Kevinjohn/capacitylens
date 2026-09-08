import { useEffect, useState } from "react";
import { m } from "@/i18n";
import { isAccountEmail } from "@capacitylens/shared/account/validation";
import { accountClient } from "../../account/accountClient";
import type { TeamMember } from "../../account/teamAccessClient";
import { readApiError } from "../../lib/readApiError";
import {
  parseWorkspaceReadiness,
  type ReadinessMember,
  type ReadinessRepairLink,
  type WorkspaceReadiness,
} from "./ssoReadiness";
import type { useTeamDirectory } from "./useTeamDirectory";
import type { MemberActionDependencies } from "./memberActionDependencies";

interface WorkspaceReadinessDependencies extends Pick<
  MemberActionDependencies,
  "requestAccountId" | "withMemberAction" | "fail" | "setNotice"
> {
  activeAccountId: string | null;
  strictProviderId: string | null;
  directory: ReturnType<typeof useTeamDirectory>["directory"];
  offlineReadOnly: boolean;
  members: TeamMember[] | null;
  refreshDirectory: () => void;
}

type WorkspaceReadinessState =
  { kind: "loading" } | { kind: "ready"; readiness: WorkspaceReadiness } | { kind: "error" };

function useReadinessState({
  activeAccountId,
  readinessApplies,
  readinessRevision,
  strictProviderId,
}: {
  activeAccountId: string | null;
  readinessApplies: boolean;
  readinessRevision: number;
  strictProviderId: string | null;
}) {
  const [readinessState, setReadinessState] = useState<WorkspaceReadinessState>({ kind: "loading" });
  useEffect(() => {
    if (!readinessApplies || !activeAccountId) return;
    const effect = { active: true };
    void (async () => {
      try {
        const response = await accountClient.getSsoReadiness(activeAccountId);
        const body: unknown = await response.json().catch(() => null);
        const parsed = parseWorkspaceReadiness(body);
        if (!response.ok || !parsed || parsed.provider.id !== strictProviderId) {
          throw new Error("Invalid SSO readiness response.");
        }
        if (effect.active) setReadinessState({ kind: "ready", readiness: parsed });
      } catch (cause) {
        console.error("MembersSection: SSO readiness failed", cause);
        if (effect.active) setReadinessState({ kind: "error" });
      }
    })();
    return () => {
      effect.active = false;
    };
  }, [activeAccountId, readinessApplies, readinessRevision, strictProviderId]);
  return readinessState;
}

function createCorrectSsoEmail({
  emailRepair,
  members,
  requestAccountId,
  withMemberAction,
  fail,
  setNotice,
  setEmailRepair,
  refreshDirectory,
}: Pick<
  WorkspaceReadinessDependencies,
  "members" | "requestAccountId" | "withMemberAction" | "fail" | "setNotice" | "refreshDirectory"
> & {
  emailRepair: { member: ReadinessMember; email: string } | null;
  setEmailRepair: (repair: null) => void;
}) {
  return async () => {
    if (!emailRepair) return;
    requestAccountId();
    const email = emailRepair.email.trim().toLowerCase();
    if (!isAccountEmail(email)) {
      fail("sso-email", m.identity_err_email());
      return;
    }
    await withMemberAction(`sso-email:${emailRepair.member.principalId}`, async (accountId) => {
      try {
        const response = await accountClient.correctMemberEmail(accountId, emailRepair.member.principalId, email);
        if (!response.ok) {
          fail("sso-email", (await readApiError(response)) ?? m.settings_sso_correct_email_error());
          return;
        }
        const changedSelf = members?.some(
          (member) => member.userId === emailRepair.member.principalId && member.isSelf,
        );
        setEmailRepair(null);
        setNotice(m.settings_sso_correct_email_done());
        if (changedSelf) window.location.reload();
        else refreshDirectory();
      } catch (cause) {
        console.error("MembersSection: SSO email correction failed", cause);
        fail("sso-email", m.settings_sso_correct_email_error());
      }
    });
  };
}

function createRemoveIncorrectSsoLink({
  members,
  withMemberAction,
  fail,
  setNotice,
  bumpReadiness,
}: Pick<WorkspaceReadinessDependencies, "members" | "withMemberAction" | "fail" | "setNotice"> & {
  bumpReadiness: () => void;
}) {
  return (member: ReadinessMember, link: ReadinessRepairLink) =>
    withMemberAction(`sso-unlink:${member.principalId}`, async (accountId) => {
      try {
        const response = await accountClient.removeFederatedLink(accountId, member.principalId, link);
        if (!response.ok) {
          fail(null, (await readApiError(response)) ?? m.settings_sso_remove_link_error());
          return;
        }
        const changedSelf = members?.some((candidate) => candidate.userId === member.principalId && candidate.isSelf);
        setNotice(m.settings_sso_remove_link_done());
        if (changedSelf) window.location.reload();
        else bumpReadiness();
      } catch (cause) {
        console.error("MembersSection: SSO link removal failed", cause);
        fail(null, m.settings_sso_remove_link_error());
      }
    });
}

export function useWorkspaceReadiness({
  activeAccountId,
  strictProviderId,
  directory,
  offlineReadOnly,
  members,
  refreshDirectory,
  requestAccountId,
  withMemberAction,
  fail,
  setNotice,
}: WorkspaceReadinessDependencies) {
  const [readinessRevision, setReadinessRevision] = useState(0);
  const [emailRepair, setEmailRepair] = useState<{ member: ReadinessMember; email: string } | null>(null);
  const [unlinkRepair, setUnlinkRepair] = useState<{
    member: ReadinessMember;
    link: ReadinessRepairLink;
  } | null>(null);
  /** Ask the readiness effect below for a fresh read. Every write that can move a membership, an
   *  email or a federated link can move the cutover projection derived from them. */
  const bumpReadiness = () => setReadinessRevision((value) => value + 1);
  // Does the SSO readiness panel apply at all? The section must be authorized (`shown`), the deploy
  // must actually have a strict OIDC provider to be ready FOR, and a cached offline session must not
  // be asking the server questions it cannot answer.
  const readinessApplies = directory.kind === "ready" && !offlineReadOnly && strictProviderId !== null;
  const readinessState = useReadinessState({
    activeAccountId,
    readinessApplies,
    readinessRevision,
    strictProviderId,
  });
  const correctSsoEmail = createCorrectSsoEmail({
    emailRepair,
    members,
    requestAccountId,
    withMemberAction,
    fail,
    setNotice,
    setEmailRepair,
    refreshDirectory,
  });
  const removeIncorrectSsoLink = createRemoveIncorrectSsoLink({
    members,
    withMemberAction,
    fail,
    setNotice,
    bumpReadiness,
  });

  return {
    readinessApplies,
    readinessState,
    emailRepair,
    setEmailRepair,
    unlinkRepair,
    setUnlinkRepair,
    bumpReadiness,
    correctSsoEmail,
    removeIncorrectSsoLink,
  };
}
