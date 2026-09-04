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
  gate: ReturnType<typeof useTeamDirectory>["gate"];
  offlineReadOnly: boolean;
  members: TeamMember[] | null;
  refreshDirectory: () => void;
}

export function useWorkspaceReadiness({
  activeAccountId,
  strictProviderId,
  gate,
  offlineReadOnly,
  members,
  refreshDirectory,
  requestAccountId,
  withMemberAction,
  fail,
  setNotice,
}: WorkspaceReadinessDependencies) {
  const [readiness, setReadiness] = useState<WorkspaceReadiness | null>(null);
  const [readinessError, setReadinessError] = useState(false);
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
  const readinessApplies = gate === "shown" && !offlineReadOnly && strictProviderId !== null;
  useEffect(() => {
    if (!readinessApplies || !activeAccountId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await accountClient.getSsoReadiness(activeAccountId);
        const body: unknown = await response.json().catch(() => null);
        const parsed = parseWorkspaceReadiness(body);
        if (!response.ok || !parsed || parsed.provider.id !== strictProviderId) {
          throw new Error("Invalid SSO readiness response.");
        }
        if (!cancelled) {
          setReadiness(parsed);
          setReadinessError(false);
        }
      } catch (cause) {
        console.error("MembersSection: SSO readiness failed", cause);
        if (!cancelled) {
          setReadiness(null);
          setReadinessError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, readinessApplies, readinessRevision, strictProviderId]);
  const correctSsoEmail = async () => {
    if (!emailRepair) return;
    // Same ordering as the inline sequence: an absent active account is raised before the draft
    // address is validated.
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
        const changedSelf = members?.some((mem) => mem.userId === emailRepair.member.principalId && mem.isSelf);
        setEmailRepair(null);
        setNotice(m.settings_sso_correct_email_done());
        if (changedSelf) {
          window.location.reload();
          return;
        }
        refreshDirectory();
      } catch (cause) {
        console.error("MembersSection: SSO email correction failed", cause);
        fail("sso-email", m.settings_sso_correct_email_error());
      }
    });
  };

  const removeIncorrectSsoLink = (member: ReadinessMember, link: ReadinessRepairLink) =>
    withMemberAction(`sso-unlink:${member.principalId}`, async (accountId) => {
      try {
        const response = await accountClient.removeFederatedLink(accountId, member.principalId, link);
        if (!response.ok) {
          fail(null, (await readApiError(response)) ?? m.settings_sso_remove_link_error());
          return;
        }
        const changedSelf = members?.some((candidate) => candidate.userId === member.principalId && candidate.isSelf);
        setNotice(m.settings_sso_remove_link_done());
        if (changedSelf) {
          window.location.reload();
          return;
        }
        bumpReadiness();
      } catch (cause) {
        console.error("MembersSection: SSO link removal failed", cause);
        fail(null, m.settings_sso_remove_link_error());
      }
    });

  return {
    readinessApplies,
    readiness,
    readinessError,
    emailRepair,
    setEmailRepair,
    unlinkRepair,
    setUnlinkRepair,
    bumpReadiness,
    correctSsoEmail,
    removeIncorrectSsoLink,
  };
}
