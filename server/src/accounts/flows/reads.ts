import type { MemberDirectoryEntry } from "@capacitylens/shared/account/ports";
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import type { LocalAccountFlowContext } from "./context";

/** Sorts a directory entry by the same fallback chain used to label it in the UI. */
function resolveDirectorySortName(entry: MemberDirectoryEntry): string {
  const principal = entry.principal;
  const displayName = principal?.displayName?.trim();
  if (displayName) return displayName;
  const email = principal?.email?.trim();
  if (email) return email;
  return entry.membership.principalId;
}

/**
 * Creates the account administration reads that also inspect local identity state.
 */
export function createAccountReadFlows(
  context: Pick<LocalAccountFlowContext, "identity" | "administration">,
): Pick<LocalAccountFlows, "resolveRequestAccess" | "listMemberDirectory"> {
  const { identity, administration } = context;
  return {
    async resolveRequestAccess({ headers, workspaceId }) {
      const session = await identity.verifyApplicationSession({ headers });
      if (!session) return null;
      const membership = await administration.getMembership({
        principalId: session.principal.id,
        workspaceId,
      });
      return membership ? { session, membership } : null;
    },

    async listMemberDirectory({ actor, workspaceId }): Promise<readonly MemberDirectoryEntry[]> {
      // The only caller that asks for non-active rows. An administrator who disabled or archived a
      // member has to be able to see that state to reverse it; every other read of this port stays
      // active-only, because a non-active membership confers no authority.
      const memberships = await administration.listMemberships({
        actor,
        workspaceId,
        includeInactive: true,
        requireFresh: false,
      });
      const principals = await identity.getPrincipalSummaries({
        principalIds: memberships.map((entry) => entry.principalId),
      });
      const byId = new Map(principals.map((principal) => [principal.id, principal]));
      return (
        memberships
          .map((entry) => ({
            membership: entry,
            principal: byId.get(entry.principalId) ?? null,
          }))
          // Join date first, then name. Founders stay at the top in the order they arrived,
          // which is how an administrator remembers the team; the name is the tie-break, because a
          // bulk import gives everyone the same joinedAt to the millisecond and an arbitrary id
          // order there reads as random. principalId last so the sort is total and the listing is
          // byte-identical between reads. Comparison is locale-aware and case-insensitive so
          // "alice" and "Alice" do not sit either side of "Bob".
          .sort(
            (left, right) =>
              left.membership.joinedAt.localeCompare(right.membership.joinedAt) ||
              resolveDirectorySortName(left).localeCompare(resolveDirectorySortName(right), undefined, {
                sensitivity: "base",
              }) ||
              left.membership.principalId.localeCompare(right.membership.principalId),
          )
      );
    },
  };
}
