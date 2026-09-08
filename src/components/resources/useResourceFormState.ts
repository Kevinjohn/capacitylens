import { useState } from "react";
import type { Resource, ResourceEngagement, Weekday } from "@capacitylens/shared/types/entities";

export function useResourceFormState(resource?: Resource) {
  const text = buildInitialTextState(resource);
  const capacity = buildInitialCapacityState(resource);
  const [name, setName] = useState(text.name);
  const [role, setRole] = useState(text.role);
  const [disciplineId, setDisciplineId] = useState(text.disciplineId);
  const [projectId, setProjectId] = useState(text.projectId);
  const [engagement, setEngagement] = useState<ResourceEngagement>(capacity.engagement);
  const [workingDays, setWorkingDays] = useState<Weekday[]>(capacity.workingDays);
  const [halfDays, setHalfDays] = useState<Weekday[]>(capacity.halfDays);
  return {
    name,
    setName,
    role,
    setRole,
    disciplineId,
    setDisciplineId,
    engagement,
    setEngagement,
    workingDays,
    setWorkingDays,
    halfDays,
    setHalfDays,
    projectId,
    setProjectId,
  };
}

function buildInitialTextState(resource?: Resource) {
  return {
    name: resource?.name ?? "",
    role: resource?.role ?? "",
    disciplineId: resource?.disciplineId ?? "",
    projectId: resource?.projectId ?? "",
  };
}

function buildInitialCapacityState(resource?: Resource) {
  return {
    engagement: resource?.engagement ?? "studio",
    workingDays: resource?.workingDays ?? [1, 2, 3, 4, 5],
    halfDays: resource?.halfDays ?? [],
  };
}

export type ResourceFormState = ReturnType<typeof useResourceFormState>;
