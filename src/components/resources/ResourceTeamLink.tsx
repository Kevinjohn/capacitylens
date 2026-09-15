import { Link } from "react-router-dom";
import { m } from "@/i18n";
import { useAuth } from "../../auth/authContext";
import { useCan, usePermissionStatus } from "../../auth/permissionContext";
import { isServerConfigured } from "../../data/apiConfig";

export function ResourceTeamLink() {
  const { authMode, user } = useAuth();
  const canManage = useCan("manageMembers");
  const permissionStatus = usePermissionStatus();
  if (authMode === "off" || !user || !isServerConfigured() || !canManage || permissionStatus !== "resolved")
    return null;
  return (
    <p className="mb-4 text-sm text-muted-foreground">
      {m.resources_team_link_help()}{" "}
      <Link to="/team" className="font-medium text-brand underline underline-offset-4" data-testid="resource-team-link">
        {m.resources_team_link()}
      </Link>
    </p>
  );
}
