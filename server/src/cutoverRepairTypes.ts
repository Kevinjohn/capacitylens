import type { Db } from "./db";
import type { mixedModeCutoverContext } from "./cutoverContext";

/** Exact stopped-server mutation selected by the cutover repair CLI. */
export type CutoverRepairOperation =
  | { kind: "remove-provider-link"; email: string; providerId: string; subject: string }
  | { kind: "deprovision-credential-orphan"; email: string }
  | { kind: "assign-workspace-owner"; workspaceId: string; email: string }
  | { kind: "erase-empty-workspace"; workspaceId: string };

/** Fully resolved repair request; destructive execution additionally requires the stopped flag. */
export interface CutoverRepairInput {
  databasePath: string;
  confirmServerStopped: boolean;
  operation: CutoverRepairOperation;
  env?: Record<string, string | undefined>;
}

/** Non-secret coordinates and durable audit id returned after one committed repair. */
export interface CutoverRepairResult {
  operation: CutoverRepairOperation["kind"];
  principalId: string | null;
  email: string | null;
  providerId: string | null;
  subject: string | null;
  auditId: string;
}

/** Context built by the facade after the database lock and schema checks pass. */
export type CutoverContext = Awaited<ReturnType<typeof mixedModeCutoverContext>>;
/** Read-only identity and link facts used to resolve one repair target. */
export type CutoverFacts = ReturnType<CutoverContext["identity"]["inspectSsoCutover"]>;
/** Principal selected by the normalized address check. */
export type CutoverPrincipal = CutoverFacts["principals"][number];

/** Inputs limited to the capabilities used by each stopped-server repair operation. */
export interface EraseEmptyWorkspaceInput {
  db: Db;
  administration: Pick<
    CutoverContext["administration"],
    "inspectSsoCutoverWorkspaces" | "eraseWorkspaceAdministrationInTx"
  >;
  operation: Extract<CutoverRepairOperation, { kind: "erase-empty-workspace" }>;
}

/** Supplies only workspace authority and target identity fields used by Owner assignment. */
export interface AssignWorkspaceOwnerInput {
  db: Db;
  administration: Pick<
    CutoverContext["administration"],
    "inspectSsoCutoverWorkspaces" | "repairOwnerlessWorkspaceInTx"
  >;
  principal: Pick<CutoverPrincipal, "id">;
  email: string;
  operation: Extract<CutoverRepairOperation, { kind: "assign-workspace-owner" }>;
}

/** Supplies provider-link facts and the single identity capability used for exact removal. */
export interface RemoveProviderLinkInput {
  identity: Pick<CutoverContext["identity"], "removeFederatedLinkForStoppedRepair">;
  configuredProviderId: CutoverContext["provider"]["id"];
  principal: Pick<CutoverPrincipal, "id">;
  email: string;
  facts: Pick<CutoverFacts, "requiredProviderLinks" | "alternativeProviderLinks">;
  operation: Extract<CutoverRepairOperation, { kind: "remove-provider-link" }>;
}

/** Supplies membership and local-identity lifecycle capabilities used for orphan deprovisioning. */
export interface DeprovisionCredentialOrphanInput {
  db: Db;
  administration: Pick<CutoverContext["administration"], "inspectSsoCutoverWorkspaces">;
  identity: Pick<CutoverContext["identity"], "deprovisionLocalPrincipalInTx" | "commitMasqueradeSessionEnds">;
  principal: Pick<CutoverPrincipal, "id" | "providerIds">;
  email: string;
}
