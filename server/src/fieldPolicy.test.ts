import { describe, expect, it } from "vitest";
import type { Role } from "@capacitylens/shared/domain/access";
import {
  GATED_FIELD_POLICIES,
  pinGatedFields,
  redactGatedEcho,
  tableHasGatedFields,
  visibilityForRole,
} from "./fieldPolicy";

const roles: Array<Role | null> = ["owner", "admin", "editor", "viewer", null];

describe("field policy catalogue", () => {
  it("derives every policy visibility flag from the same role predicate", () => {
    for (const role of roles) {
      const visibility = visibilityForRole(role);
      for (const policy of GATED_FIELD_POLICIES) {
        expect(visibility[policy.visKey]).toBe(
          role !== null && policy.visibleTo(role),
        );
      }
    }
  });

  it("identifies every governed table and no ordinary table", () => {
    const governed = new Set(
      GATED_FIELD_POLICIES.flatMap((policy) => policy.tables),
    );
    for (const table of governed) expect(tableHasGatedFields(table)).toBe(true);
    expect(tableHasGatedFields("resources")).toBe(false);
  });

  it("redacts note and private-name fields only for blind callers", () => {
    expect(
      redactGatedEcho(
        "timeOff",
        { id: "to-1", note: "private" },
        { canSeeTimeOffNote: false },
      ),
    ).toEqual({ id: "to-1" });
    expect(
      redactGatedEcho(
        "timeOff",
        { id: "to-1", note: "private" },
        { canSeeTimeOffNote: true },
      ),
    ).toEqual({ id: "to-1", note: "private" });
    expect(
      redactGatedEcho(
        "clients",
        {
          id: "client-1",
          name: "Real client",
          isPrivate: true,
          codeName: "Project Finch",
          color: "#fff",
        },
        { canSeePrivateNames: false },
      ),
    ).toEqual({
      id: "client-1",
      name: '"Project Finch"',
      isPrivate: true,
      color: "#fff",
    });
  });

  it("pins stored gated fields on blind updates and strips them from blind creates", () => {
    const timeOffUpdate = { note: "attempted overwrite" };
    pinGatedFields(
      "timeOff",
      timeOffUpdate,
      { note: "stored note" },
      { canSeeTimeOffNote: false },
    );
    expect(timeOffUpdate).toEqual({ note: "stored note" });

    const privateUpdate: Record<string, unknown> = {
      name: "Project Finch",
      isPrivate: false,
      codeName: "attempted overwrite",
      color: "#000",
    };
    pinGatedFields(
      "clients",
      privateUpdate,
      {
        name: "Real client",
        isPrivate: true,
        codeName: "Project Finch",
      },
      { canSeePrivateNames: false },
    );
    expect(privateUpdate).toEqual({
      name: "Real client",
      isPrivate: true,
      codeName: "Project Finch",
      color: "#000",
    });

    const blindCreate: Record<string, unknown> = {
      name: "Public client",
      isPrivate: true,
      codeName: "Hidden",
    };
    pinGatedFields("clients", blindCreate, undefined, {
      canSeePrivateNames: false,
    });
    expect(blindCreate).toEqual({ name: "Public client" });
  });
});
