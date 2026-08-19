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

    const options = buildActivityOptions(activities, phases, projects, "project", project.id);

    expect(options).toHaveLength(200);
    expect(options.slice(0, 2)).toEqual([
      { value: "activity-0", label: "Workshop / Discovery (1)", groupLabel: "Project-specific" },
      { value: "activity-1", label: "Workshop / Discovery (2)", groupLabel: "Project-specific" },
    ]);
    expect(phaseFind).not.toHaveBeenCalled();
    expect(projectFind).not.toHaveBeenCalled();
  });

  it("filters by exact activity kind and sorts labels alphabetically", () => {
    const activities: Activity[] = [
      { ...row, id: "repeat-z", name: "Strategy", kind: "repeatable" },
      { ...row, id: "internal-z", name: "Support", kind: "internal" },
      { ...row, id: "repeat-a", name: "Retrospective", kind: "repeatable" },
      { ...row, id: "internal-a", name: "Admin", kind: "internal" },
      { ...row, id: "project", name: "Briefing", kind: "project", projectId: "project" },
    ];

    expect(buildActivityOptions(activities, [], [], "internal")).toEqual([
      { value: "internal-a", label: "Admin" },
      { value: "internal-z", label: "Support" },
    ]);
    expect(buildActivityOptions(activities, [], [], "repeatable")).toEqual([
      { value: "repeat-a", label: "Retrospective" },
      { value: "repeat-z", label: "Strategy" },
    ]);
    expect(buildActivityOptions(activities, [], [], "project", "project")).toEqual([
      { value: "repeat-a", label: "Retrospective", groupLabel: "All projects" },
      { value: "repeat-z", label: "Strategy", groupLabel: "All projects" },
      { value: "project", label: "Briefing", groupLabel: "Project-specific" },
    ]);
  });

  it("excludes project activities belonging to another project", () => {
    const activities: Activity[] = [
      { ...row, id: "wayne", name: "Briefing", kind: "project", projectId: "wayne-project" },
      { ...row, id: "stark", name: "Briefing", kind: "project", projectId: "stark-project" },
    ];

    expect(buildActivityOptions(activities, [], [], "project", "wayne-project")).toEqual([
      { value: "wayne", label: "Briefing", groupLabel: "Project-specific" },
    ]);
  });

  it("does not apply the project id filter to non-project activities", () => {
    const malformed = {
      ...row,
      id: "internal-with-project",
      name: "Support",
      kind: "internal",
      projectId: "legacy-project",
    } as Activity;

    expect(buildActivityOptions([malformed], [], [], "internal", "another-project")).toEqual([
      { value: malformed.id, label: "Support" },
    ]);
  });

  it.each([
    ["internal", "Internal"],
    ["repeatable", "Cross-project"],
  ] as const)("uses the %s kind as context when duplicate names need disambiguation", (kind, context) => {
    const activities: Activity[] = [
      { ...row, id: `${kind}-b`, name: "Planning", kind },
      { ...row, id: `${kind}-a`, name: "Planning", kind },
    ];

    expect(buildActivityOptions(activities, [], [], kind)).toEqual([
      { value: `${kind}-a`, label: `Planning / ${context} (1)` },
      { value: `${kind}-b`, label: `Planning / ${context} (2)` },
    ]);
  });

  it("prefers phase context and falls back through project name to the generic project label", () => {
    const project: Project = {
      ...row,
      id: "project",
      clientId: "client",
      name: "Website",
      color: "#123456",
    };
    const phase: Phase = { ...row, id: "phase", projectId: project.id, name: "Discovery" };
    const activities: Activity[] = [
      {
        ...row,
        id: "with-phase",
        name: "Workshop",
        kind: "project",
        projectId: project.id,
        phaseId: phase.id,
      },
      { ...row, id: "with-project", name: "Workshop", kind: "project", projectId: project.id },
      { ...row, id: "without-metadata", name: "Workshop", kind: "project", projectId: project.id },
    ];

    expect(buildActivityOptions(activities, [phase], [project], "project", project.id)).toEqual([
      { value: "with-phase", label: "Workshop / Discovery", groupLabel: "Project-specific" },
      { value: "with-project", label: "Workshop / Website (1)", groupLabel: "Project-specific" },
      { value: "without-metadata", label: "Workshop / Website (2)", groupLabel: "Project-specific" },
    ]);

    expect(buildActivityOptions(activities, [], [], "project", project.id)).toEqual([
      { value: "with-phase", label: "Workshop / Project (1)", groupLabel: "Project-specific" },
      { value: "with-project", label: "Workshop / Project (2)", groupLabel: "Project-specific" },
      { value: "without-metadata", label: "Workshop / Project (3)", groupLabel: "Project-specific" },
    ]);
  });

  it("groups All-projects activities first and disambiguates names across the combined project scope", () => {
    const project: Project = {
      ...row,
      id: "project",
      clientId: "client",
      name: "Website",
      color: "#123456",
    };
    const activities: Activity[] = [
      { ...row, id: "repeat-design", name: "Design", kind: "repeatable" },
      { ...row, id: "repeat-admin", name: "Admin", kind: "repeatable" },
      { ...row, id: "project-design", name: "Design", kind: "project", projectId: project.id },
      { ...row, id: "project-build", name: "Build", kind: "project", projectId: project.id },
    ];

    expect(buildActivityOptions(activities, [], [project], "project", project.id)).toEqual([
      { value: "repeat-admin", label: "Admin", groupLabel: "All projects" },
      { value: "repeat-design", label: "Design / Cross-project", groupLabel: "All projects" },
      { value: "project-build", label: "Build", groupLabel: "Project-specific" },
      { value: "project-design", label: "Design / Website", groupLabel: "Project-specific" },
    ]);
  });

  it("uses the generic context when duplicate project activities have no project id", () => {
    const activities = [
      { ...row, id: "project-a", name: "Workshop", kind: "project" },
      { ...row, id: "project-b", name: "Workshop", kind: "project" },
    ] as Activity[];

    expect(buildActivityOptions(activities, [], [], "project")).toEqual([
      { value: "project-a", label: "Workshop / Project (1)" },
      { value: "project-b", label: "Workshop / Project (2)" },
    ]);
  });

  it("sorts labels case-insensitively and breaks equal-label ties by id", () => {
    const activities: Activity[] = [
      { ...row, id: "z", name: "alpha", kind: "internal" },
      { ...row, id: "b", name: "Alpha", kind: "internal" },
      { ...row, id: "a", name: "Alpha", kind: "internal" },
    ];

    expect(buildActivityOptions(activities, [], [], "internal")).toEqual([
      { value: "z", label: "alpha" },
      { value: "a", label: "Alpha / Internal (1)" },
      { value: "b", label: "Alpha / Internal (2)" },
    ]);
  });

  it("treats accent-only label differences as equal before applying the id tie-break", () => {
    const activities: Activity[] = [
      { ...row, id: "z", name: "resume", kind: "internal" },
      { ...row, id: "a", name: "Résumé", kind: "internal" },
    ];

    expect(buildActivityOptions(activities, [], [], "internal")).toEqual([
      { value: "a", label: "Résumé" },
      { value: "z", label: "resume" },
    ]);
  });
});
