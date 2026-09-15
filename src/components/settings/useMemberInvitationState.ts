import type { TeamMember as Member } from "../../account/teamAccessClient";
import type { useTeamDirectory } from "./useTeamDirectory";

export type InvitationDirectoryState = {
  directory: ReturnType<typeof useTeamDirectory>["directory"];
  members: readonly Member[] | null;
};

export function resolveInvitationDirectoryBoundary(directoryState: InvitationDirectoryState): {
  authorized: boolean;
  key: string;
} {
  const self = directoryState.members?.find((member) => member.isSelf);
  const authorized =
    directoryState.directory.kind === "ready" &&
    self?.status === "active" &&
    (self.role === "owner" || self.role === "admin");
  if (authorized) return { authorized: true, key: "authorized" };
  switch (directoryState.directory.kind) {
    case "error":
      return { authorized: false, key: directoryState.directory.content.kind };
    case "hidden":
      return { authorized: false, key: "hidden" };
    case "loading":
      return { authorized: false, key: "loading" };
    case "ready":
      return { authorized: false, key: "ready" };
  }
}
