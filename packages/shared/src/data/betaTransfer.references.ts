import type { AppData } from "../types/entities.js";
import { INTERNAL_CLIENT_COLOR, INTERNAL_CLIENT_NAME } from "./internalClient.js";
import { effectiveProjectId, validateAllocationAssignment } from "../lib/integrity.js";
import { assert } from "./betaTransfer.errors.js";

/** Validate references and cross-row invariants without active-only write restrictions. */
export function validateBetaReferences(data: AppData): void {
  const disciplines = new Set(data.disciplines.map((row) => row.id));
  const resources = new Map(data.resources.map((row) => [row.id, row]));
  const clients = new Map(data.clients.map((row) => [row.id, row]));
  const projects = new Map(data.projects.map((row) => [row.id, row]));
  const phases = new Map(data.phases.map((row) => [row.id, row]));
  const activities = new Map(data.activities.map((row) => [row.id, row]));

  const internal = data.clients.filter((row) => row.builtin === true);
  assert(internal.length === 1, "data.clients", "must contain exactly one built-in Internal client");
  const canonicalInternal = internal[0];
  assert(canonicalInternal, "data.clients", "must contain exactly one built-in Internal client");
  assert(
    canonicalInternal.name === INTERNAL_CLIENT_NAME &&
      canonicalInternal.color === INTERNAL_CLIENT_COLOR &&
      canonicalInternal.archivedAt === null &&
      canonicalInternal.deletedAt === null,
    "data.clients",
    "built-in Internal client must be canonical and active",
  );

  for (const [index, row] of data.resources.entries()) {
    if (row.disciplineId !== null)
      assert(
        disciplines.has(row.disciplineId),
        `data.resources[${index}].disciplineId`,
        "references a missing discipline",
      );
    if (row.projectId !== null)
      assert(projects.has(row.projectId), `data.resources[${index}].projectId`, "references a missing project");
    if (row.firstAvailableDate && row.lastAvailableDate)
      assert(
        row.firstAvailableDate <= row.lastAvailableDate,
        `data.resources[${index}]`,
        "availability dates are reversed",
      );
  }
  for (const [index, row] of data.projects.entries())
    assert(clients.has(row.clientId), `data.projects[${index}].clientId`, "references a missing client");
  for (const [index, row] of data.phases.entries())
    assert(projects.has(row.projectId), `data.phases[${index}].projectId`, "references a missing project");
  for (const [index, row] of data.activities.entries()) {
    if (row.projectId !== null)
      assert(projects.has(row.projectId), `data.activities[${index}].projectId`, "references a missing project");
    if (row.phaseId !== null)
      assert(
        phases.get(row.phaseId)?.projectId === row.projectId,
        `data.activities[${index}].phaseId`,
        "phase must belong to the activity project",
      );
  }
  for (const [index, row] of data.allocations.entries()) {
    const resource = resources.get(row.resourceId);
    const activity = activities.get(row.activityId);
    assert(resource, `data.allocations[${index}].resourceId`, "references a missing resource");
    assert(activity, `data.allocations[${index}].activityId`, "references a missing activity");
    if (resource.kind === "external")
      assert(
        row.hoursPerDay === 0,
        `data.allocations[${index}].hoursPerDay`,
        "external allocations must carry zero hours",
      );
    if (activity.kind !== "repeatable")
      assert(
        row.projectId === null,
        `data.allocations[${index}].projectId`,
        "only repeatable activities may carry project attribution",
      );
    if (row.projectId !== null)
      assert(projects.has(row.projectId), `data.allocations[${index}].projectId`, "references a missing project");
    const effective = effectiveProjectId(row, activity);
    const assignment = validateAllocationAssignment(resource, effective);
    assert(assignment.ok, `data.allocations[${index}].projectId`, assignment.errors.join(" "));
  }
  for (const [index, row] of data.timeOff.entries()) {
    const resource = resources.get(row.resourceId);
    assert(
      resource && resource.kind !== "external",
      `data.timeOff[${index}].resourceId`,
      "time off must reference a person or placeholder",
    );
  }
}
