import type { JoiningPolicySettings } from "@capacitylens/shared/account/types";
import { apiFetch } from "@/data/requestTimeout";
import { buildPayloadOperationKey } from "./commandOutcome";
import { buildCommandRequestInit } from "./commandRequest";
import { runCommand } from "./commandRequest";
import { apiRouteUrl } from "@/api/queryClient";

/** Company joining-policy requests exposed through the existing accountClient surface. */
export const joiningPolicyClient = {
  readJoiningPolicy(workspaceId: string): Promise<Response> {
    return apiFetch(apiRouteUrl("api.joining.policy", { params: { accountId: workspaceId } }), {
      credentials: "include",
    });
  },

  async setJoiningPolicy(workspaceId: string, settings: JoiningPolicySettings): Promise<Response> {
    return runCommand({
      operationKey: await buildPayloadOperationKey(`joining-policy:${workspaceId}`, settings),
      explicit: undefined,
      request: (command) =>
        apiFetch(
          apiRouteUrl("api.joining.update-policy", { params: { accountId: workspaceId } }),
          buildCommandRequestInit(
            {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(settings),
            },
            command,
          ),
        ),
    });
  },
};
