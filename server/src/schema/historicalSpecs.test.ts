import { describe, expect, it } from "vitest";
import {
  buildAccountsTableAtVersion,
  V27_TABLES,
  V28_TABLES,
  V29_TABLES,
  V30_TABLES,
  V31_TABLES,
  V32_TABLES,
  V33_TABLES,
  V34_TABLES,
  V35_TABLES,
  V36_TABLES,
  V37_TABLES,
  V38_TABLES,
  V39_TABLES,
  V40_TABLES,
} from "./historicalSpecs";
import type { TableSpec } from "../tables";
import { TABLES } from "../tables";

const V27_ACCOUNT_COLUMNS = [
  "id",
  "name",
  "color",
  "schedulingMode",
  "timezone",
  "weekStartsOn",
  "language",
  "disciplinesEnabled",
  "placeholdersEnabled",
  "externalEnabled",
  "internalColourMode",
  "showInternalProjects",
  "showInternalActivities",
  "inlineActivityCreateEnabled",
  "createdAt",
  "updatedAt",
] as const;
const V28_ACCOUNT_COLUMNS = V27_ACCOUNT_COLUMNS;
const V29_ACCOUNT_COLUMNS = V27_ACCOUNT_COLUMNS;
const V30_ACCOUNT_COLUMNS = [
  "id",
  "name",
  "color",
  "schedulingMode",
  "timezone",
  "weekStartsOn",
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
const V31_ACCOUNT_COLUMNS = [
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
const V32_ACCOUNT_COLUMNS = V31_ACCOUNT_COLUMNS;
const V33_ACCOUNT_COLUMNS = V31_ACCOUNT_COLUMNS;
const V34_ACCOUNT_COLUMNS = V31_ACCOUNT_COLUMNS;
const V35_ACCOUNT_COLUMNS = V31_ACCOUNT_COLUMNS;
const V36_ACCOUNT_COLUMNS = V31_ACCOUNT_COLUMNS;
const V37_ACCOUNT_COLUMNS = [
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
  "showTaskFieldInSchedule",
  "createdAt",
  "updatedAt",
] as const;
const V38_ACCOUNT_COLUMNS = V37_ACCOUNT_COLUMNS;
const V39_ACCOUNT_COLUMNS = [
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
  "showTaskFieldInSchedule",
  "capacityOverviewAccess",
  "createdAt",
  "updatedAt",
] as const;
const V40_ACCOUNT_COLUMNS = [
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
  "showTaskFieldInSchedule",
  "capacityOverviewAccess",
  "dateStyle",
  "createdAt",
  "updatedAt",
] as const;

function accountColumnNamesFromTable(table: TableSpec): string[] {
  return table.columns.map(({ name }) => name);
}

function accountColumnNamesFromTables(tables: Partial<Record<string, TableSpec>>): string[] {
  const accounts = tables.accounts;
  if (!accounts) throw new Error("Historical table spec is missing the accounts table.");
  return accountColumnNamesFromTable(accounts);
}

describe("historical account schema derivation", () => {
  it.each([
    ["V27", V27_TABLES, V27_ACCOUNT_COLUMNS],
    ["V28", V28_TABLES, V28_ACCOUNT_COLUMNS],
    ["V29", V29_TABLES, V29_ACCOUNT_COLUMNS],
    ["V30", V30_TABLES, V30_ACCOUNT_COLUMNS],
    ["V31", V31_TABLES, V31_ACCOUNT_COLUMNS],
    ["V32", V32_TABLES, V32_ACCOUNT_COLUMNS],
    ["V33", V33_TABLES, V33_ACCOUNT_COLUMNS],
    ["V34", V34_TABLES, V34_ACCOUNT_COLUMNS],
    ["V35", V35_TABLES, V35_ACCOUNT_COLUMNS],
    ["V36", V36_TABLES, V36_ACCOUNT_COLUMNS],
    ["V37", V37_TABLES, V37_ACCOUNT_COLUMNS],
    ["V38", V38_TABLES, V38_ACCOUNT_COLUMNS],
    ["V39", V39_TABLES, V39_ACCOUNT_COLUMNS],
    ["V40", V40_TABLES, V40_ACCOUNT_COLUMNS],
  ] as const)("keeps the released %s account columns frozen", (_version, tables, expected) => {
    expect(accountColumnNamesFromTables(tables)).toEqual(expected);
  });

  it("rejects a live account column without an introduction version", () => {
    const accounts = TABLES.accounts;
    if (!accounts) throw new Error("Expected the live accounts table.");
    const originalColumns = accounts.columns;
    accounts.columns = [...originalColumns, { name: "unversionedAccountPreference" }];

    try {
      expect(() => buildAccountsTableAtVersion(40)).toThrowError(
        'Missing ACCOUNT_COLUMN_INTRODUCED_AT entry for live accounts column "unversionedAccountPreference".',
      );
    } finally {
      accounts.columns = originalColumns;
    }
  });

  it("rejects historical table contracts without an accounts table", () => {
    expect(() => accountColumnNamesFromTables({})).toThrowError("Historical table spec is missing the accounts table.");
  });

  it("adds each account column at its migration boundary", () => {
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(29))).not.toContain("groupResourcesByEngagement");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(30))).toContain("groupResourcesByEngagement");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(30))).not.toContain("workingDays");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(31))).toContain("workingDays");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(36))).not.toContain("showTaskFieldInSchedule");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(37))).toContain("showTaskFieldInSchedule");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(38))).not.toContain("capacityOverviewAccess");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(39))).toContain("capacityOverviewAccess");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(39))).not.toContain("dateStyle");
    expect(accountColumnNamesFromTable(buildAccountsTableAtVersion(40))).toContain("dateStyle");
  });
});
