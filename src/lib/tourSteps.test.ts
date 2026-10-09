import { describe, expect, it } from "vitest";
import { buildRoleTour } from "./tourSteps";

const idsByRole = {
  owner: [
    "owner-import",
    "admin-invite",
    "admin-example-data",
    "editor-resources",
    "editor-hierarchy",
    "editor-book",
    "viewer-grid",
    "viewer-toolbar",
  ],
  admin: [
    "admin-invite",
    "admin-example-data",
    "editor-resources",
    "editor-hierarchy",
    "editor-book",
    "viewer-grid",
    "viewer-toolbar",
  ],
  editor: ["editor-resources", "editor-hierarchy", "editor-book", "viewer-grid", "viewer-toolbar"],
  viewer: ["viewer-grid", "viewer-toolbar"],
};

describe("buildRoleTour", () => {
  it.each(Object.entries(idsByRole))("starts %s at that role's segment and includes lower roles", (role, ids) => {
    expect(buildRoleTour({ role: role as keyof typeof idsByRole, serverMode: true }).map((step) => step.id)).toEqual(
      ids,
    );
  });

  it("defaults a missing role to Owner and omits server-only example data in demo mode", () => {
    expect(buildRoleTour({ role: null, serverMode: false }).map((step) => step.id)).toEqual(
      idsByRole.owner.filter((id) => id !== "admin-example-data"),
    );
  });

  it.each(Object.entries(idsByRole))("omits only the example-data stop in demo mode for %s", (role, ids) => {
    expect(buildRoleTour({ role: role as keyof typeof idsByRole, serverMode: false }).map((step) => step.id)).toEqual(
      ids.filter((id) => id !== "admin-example-data"),
    );
  });

  it("waits only for scheduler grid and toolbar steps", () => {
    const steps = buildRoleTour({ role: "owner", serverMode: true });
    expect(steps.filter((step) => step.waitForElement).map((step) => step.id)).toEqual([
      "editor-book",
      "viewer-grid",
      "viewer-toolbar",
    ]);
  });

  it("marks each role segment's first stop", () => {
    const steps = buildRoleTour({ role: "owner", serverMode: true });
    expect([steps[0]?.segment, steps[1]?.segment, steps[3]?.segment, steps[6]?.segment]).toEqual([
      "owner",
      "admin",
      "editor",
      "viewer",
    ]);
  });
});
