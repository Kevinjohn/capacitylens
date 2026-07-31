import { describe, expect, it, vi } from "vitest";
import type { Activity, Phase, Project } from "@capacitylens/shared/types/entities";
import { buildActivityOptions } from "./activityOptions";

const row = { accountId: "account", createdAt: "t", updatedAt: "t" } as const;

describe("buildActivityOptions", () => {
  it("resolves and numbers a large duplicate set without rescanning metadata arrays", () => {
    const project: Project = {
      ...row,
      id: "project",
      clientId: "client",
      name: "Launch",
      color: "#123456",
    };
    const phases: Phase[] = Array.from({ length: 200 }, (_, index) => ({
      ...row,
      id: `phase-${index}`,
      projectId: project.id,
      name: index < 2 ? "Discovery" : `Phase ${index}`,
    }));
    const activities: Activity[] = phases.map((phase, index) => ({
      ...row,
      id: `activity-${index}`,
      kind: "project",
      projectId: project.id,
      phaseId: phase.id,
      name: "Workshop",
    }));
    const phaseFind = vi.spyOn(phases, "find");
    const projects = [project];
    const projectFind = vi.spyOn(projects, "find");

    const options = buildActivityOptions(activities, phases, projects, project.id);

    expect(options).toHaveLength(200);
    expect(options.slice(0, 3)).toEqual([
      { value: "activity-0", label: "Workshop / Discovery (1)" },
      { value: "activity-1", label: "Workshop / Discovery (2)" },
      { value: "activity-2", label: "Workshop / Phase 2" },
    ]);
    expect(phaseFind).not.toHaveBeenCalled();
    expect(projectFind).not.toHaveBeenCalled();
  });
});
