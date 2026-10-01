import { describe, expect, it } from "vitest";
import { remapAndValidateImport } from "../domain/mutations";
import { isPresetColor } from "../lib/color";
import { dayIndex, weekdayOf } from "../lib/dateMath";
import { emptyAppData, type AppData } from "../types/entities";
import { buildExampleCompany, countExampleRows } from "./exampleCompany";

const ACCOUNT = "a-example";
const NOW = "2031-09-17T10:00:00.000Z";
const WEDNESDAY = "2031-09-17"; // week starts Monday 15th

function build(overrides: Partial<Parameters<typeof buildExampleCompany>[0]> = {}) {
  return buildExampleCompany({ accountId: ACCOUNT, referenceDate: WEDNESDAY, now: NOW, ...overrides });
}

describe("buildExampleCompany", () => {
  it("builds exactly the documented small company, every row in the company", () => {
    const data = build();
    expect(data.resources.map((row) => [row.name, row.role])).toEqual([
      ["Dick Grayson", "Designer"],
      ["Barbara Gordon", "Developer"],
    ]);
    expect(data.disciplines).toHaveLength(2);
    expect(data.clients).toHaveLength(1);
    expect(data.projects).toHaveLength(1);
    expect(data.phases).toHaveLength(1);
    expect(data.activities.map((row) => row.kind).sort()).toEqual(["internal", "project", "project"]);
    expect(data.timeOff).toHaveLength(1);
    expect(countExampleRows(data)).toBe(15);
    for (const rows of Object.values(data) as { accountId: string }[][])
      for (const row of rows) expect(row.accountId).toBe(ACCOUNT);
  });

  it("mints fresh unique ids on every call", () => {
    const ids = (data: AppData) =>
      (Object.values(data) as { id: string }[][]).flatMap((rows) => rows.map((row) => row.id));
    const first = ids({ ...emptyAppData(), ...build() });
    const second = ids({ ...emptyAppData(), ...build() });
    expect(new Set([...first, ...second]).size).toBe(first.length + second.length);
  });

  it("opens on the reference week and spans this week and the next on working days", () => {
    const { allocations, timeOff } = build();
    const starts = allocations.map((row) => dayIndex(row.startDate, "2031-09-15"));
    expect(Math.min(...starts)).toBe(0);
    expect(Math.max(...allocations.map((row) => dayIndex(row.endDate, "2031-09-15")))).toBeGreaterThan(6);
    for (const row of [...allocations, ...timeOff]) {
      expect(weekdayOf(row.startDate)).not.toBe(0);
      expect(weekdayOf(row.startDate)).not.toBe(6);
      expect(weekdayOf(row.endDate)).not.toBe(0);
      expect(weekdayOf(row.endDate)).not.toBe(6);
    }
  });

  it("lands on the company's own week when weeks start on Sunday", () => {
    const sunday = "2031-09-14";
    const { allocations } = build({ referenceDate: sunday, weekStartsOn: 0 });
    expect(allocations.map((row) => row.startDate).sort()[0]).toBe("2031-09-15");
  });
});

describe("buildExampleCompany rules", () => {
  it("follows the activity, project and colour rules", () => {
    const data = build();
    const colourOf = new Map(data.disciplines.map((row) => [row.id, row.color]));
    for (const person of data.resources) expect(person.color).toBe(colourOf.get(person.disciplineId ?? ""));
    for (const row of [...data.disciplines, ...data.resources, ...data.clients, ...data.projects]) {
      expect(isPresetColor(row.color)).toBe(true);
    }
    for (const activity of data.activities) {
      expect(activity.projectId === undefined).toBe(activity.kind !== "project");
      expect(activity.phaseId === undefined || activity.kind === "project").toBe(true);
    }
  });

  it("passes the import integrity checks with nothing dropped or repaired away", () => {
    const data = build();
    const base: AppData = {
      ...emptyAppData(),
      accounts: [{ id: ACCOUNT, name: "Wayne Enterprises", color: "#2d75da", createdAt: NOW, updatedAt: NOW }],
    };
    const result = remapAndValidateImport(base, ACCOUNT, { ...emptyAppData(), ...data }, NOW);
    expect(result.skipped).toBe(0);
    expect(result.imported).toBe(countExampleRows(data));
    expect(result.data.allocations).toHaveLength(data.allocations.length);
    expect(result.data.timeOff).toHaveLength(data.timeOff.length);
  });
});
