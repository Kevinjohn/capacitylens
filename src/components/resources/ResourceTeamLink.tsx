import { Link } from "react-router-dom";
import { m } from "@/i18n";
import { useCan, usePermissionStatus } from "../../auth/permissionContext";
import { Button } from "../ui/button";

export function ResourceTeamLink() {
  const canManage = useCan("manageMembers");
  const permissionStatus = usePermissionStatus();
  if (!canManage || permissionStatus !== "resolved") return null;
  return (
    <p className="mb-4 text-sm text-muted-foreground">
      {m.resources_team_link_help()}{" "}
      <Button asChild variant="link" className="h-auto p-0">
        <Link to="/team" data-testid="resource-team-link">
          {m.resources_team_link()}
        </Link>
      </Button>
    </p>
  );
}
