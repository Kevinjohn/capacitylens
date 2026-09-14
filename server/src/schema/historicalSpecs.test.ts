import { describe, expect, it } from "vitest";
import {
  buildAccountsTableAtVersion,
  V36_TABLES,
  V37_TABLES,
  V38_TABLES,
  V39_TABLES,
  V40_TABLES,
} from "./historicalSpecs";
import type { TableSpec } from "../tables";

const PRE_V37_ACCOUNT_COLUMNS = [
  "id",
  "name",
  "color",
  "schedulingMode",
  "timezone",
  "weekStartsOn",
  "workingDays",
  "language",
  "disciplinesEnabled",
  "groupResourcesByEngagement",
  "placeholdersEnabled",
  "externalEnabled",
  "internalColourMode",
  "showInternalProjects",
  "showInternalActivities",
  "inlineActivityCreateEnabled",
  "createdAt",
  "updatedAt",
] as const;

const V37_ACCOUNT_COLUMNS = [
  ...PRE_V37_ACCOUNT_COLUMNS.slice(0, -2),
  "showTaskFieldInSchedule",
  ...PRE_V37_ACCOUNT_COLUMNS.slice(-2),
] as const;
const V38_ACCOUNT_COLUMNS = V37_ACCOUNT_COLUMNS;
const V39_ACCOUNT_COLUMNS = [
  ...V38_ACCOUNT_COLUMNS.slice(0, -2),
  "capacityOverviewAccess",
  ...V38_ACCOUNT_COLUMNS.slice(-2),
] as const;
const V40_ACCOUNT_COLUMNS = [
  ...V39_ACCOUNT_COLUMNS.slice(0, -2),
  "dateStyle",
  ...V39_ACCOUNT_COLUMNS.slice(-2),
] as const;

function accountColumnNames(table: { accounts?: TableSpec } | TableSpec): string[] {
  const tableSpec = "key" in table ? table : table.accounts;
  return tableSpec?.columns.map(({ name }) => name) ?? [];
}

describe("historical account schema derivation", () => {
  it.each([
    ["PRE_V37", V36_TABLES, PRE_V37_ACCOUNT_COLUMNS],
    ["V37", V37_TABLES, V37_ACCOUNT_COLUMNS],
    ["V38", V38_TABLES, V38_ACCOUNT_COLUMNS],
    ["V39", V39_TABLES, V39_ACCOUNT_COLUMNS],
    ["V40", V40_TABLES, V40_ACCOUNT_COLUMNS],
  ] as const)("keeps the released %s account columns frozen", (_version, tables, expected) => {
    expect(accountColumnNames(tables)).toEqual(expected);
  });

  it("adds each account column at its migration boundary", () => {
    expect(accountColumnNames(buildAccountsTableAtVersion(29))).not.toContain("groupResourcesByEngagement");
    expect(accountColumnNames(buildAccountsTableAtVersion(30))).toContain("groupResourcesByEngagement");
    expect(accountColumnNames(buildAccountsTableAtVersion(30))).not.toContain("workingDays");
    expect(accountColumnNames(buildAccountsTableAtVersion(31))).toContain("workingDays");
    expect(accountColumnNames(buildAccountsTableAtVersion(36))).not.toContain("showTaskFieldInSchedule");
    expect(accountColumnNames(buildAccountsTableAtVersion(37))).toContain("showTaskFieldInSchedule");
    expect(accountColumnNames(buildAccountsTableAtVersion(38))).not.toContain("capacityOverviewAccess");
    expect(accountColumnNames(buildAccountsTableAtVersion(39))).toContain("capacityOverviewAccess");
    expect(accountColumnNames(buildAccountsTableAtVersion(39))).not.toContain("dateStyle");
    expect(accountColumnNames(buildAccountsTableAtVersion(40))).toContain("dateStyle");
  });
});
