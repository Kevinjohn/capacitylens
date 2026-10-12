import type { JoiningPolicySettings } from "@capacitylens/shared/account/types";
import { API_BASE } from "@/data/apiConfig";
import { apiFetch } from "@/data/requestTimeout";
import { buildPayloadOperationKey } from "./commandOutcome";
import { buildCommandRequestInit } from "./commandRequest";
import { runCommand } from "./commandRequest";

/** Company joining-policy requests exposed through the existing accountClient surface. */
export const joiningPolicyClient = {
  readJoiningPolicy(workspaceId: string): Promise<Response> {
    return apiFetch(`${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/joining-policy`, {
      credentials: "include",
    });
  },

  async setJoiningPolicy(workspaceId: string, settings: JoiningPolicySettings): Promise<Response> {
    return runCommand({
      operationKey: await buildPayloadOperationKey(`joining-policy:${workspaceId}`, settings),
      explicit: undefined,
      request: (command) =>
        apiFetch(
          `${API_BASE}/api/accounts/${encodeURIComponent(workspaceId)}/joining-policy`,
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
