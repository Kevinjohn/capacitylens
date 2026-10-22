import { describe, expect, it } from "vitest";
import { seed } from "./seed.js";
import {
  BETA_EXPORT_FORMAT,
  BETA_EXPORT_SCHEMA_VERSION,
  BetaTransferError,
  buildBetaExport,
  parseBetaExport,
  prepareBetaImport,
  serializeBetaExport,
} from "./betaTransfer.js";
import { APP_DATA_KEYS } from "../types/entityKeys.js";
import { internalClientIdFor } from "./internalClient.js";

const original = seed();
const accountId = original.accounts[0]?.id ?? "";
const context = {
  accountId,
  memberResourceLinks: [{ memberId: "member-1", resourceId: original.resources[0]?.id ?? "" }],
};
function fixture<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} in the test fixture`);
  return value;
}

describe("beta-native transfer", () => {
  it("round-trips the Internal client ID created for a new company", () => {
    const source = structuredClone(original);
    const internal = fixture(
      source.clients.find((row) => row.accountId === accountId && row.builtin),
      "Internal client",
    );
    internal.id = internalClientIdFor(accountId);
    const exported = buildBetaExport(source, { accountId, completeness: "full" });
    const parsed = parseBetaExport(serializeBetaExport(exported));
    expect(parsed.data.clients.find((row) => row.builtin)?.id).toBe(internal.id);
    expect(prepareBetaImport(parsed, context).data.clients.find((row) => row.builtin)?.id).toBe(internal.id);
  });

  it("round-trips every table, supported private content, archived rows, settings and IDs", () => {
    const source = structuredClone(original);
    const account = fixture(source.accounts[0], "account");
    account.name = "Wayne Enterprises";
    source.closures.push({
      id: "closure-wayne-holiday",
      accountId,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      name: "Wayne Foundation Day",
      startDate: "2026-12-25",
      endDate: "2026-12-25",
    });
    const privateClient = fixture(
      source.clients.find((row) => row.builtin !== true),
      "non-Internal client",
    );
    privateClient.isPrivate = true;
    privateClient.codeName = "Project Bat";
    const privateProject = fixture(source.projects[0], "project");
    privateProject.isPrivate = true;
    privateProject.codeName = "Project Bat Project";
    const placeholder = fixture(
      source.resources.find((row) => row.kind === "placeholder"),
      "placeholder resource",
    );
    const internalActivity = fixture(
      source.activities.find((row) => row.kind === "internal"),
      "internal activity",
    );
    const templateBooking = fixture(source.allocations[0], "allocation");
    source.allocations.push({
      ...templateBooking,
      id: "a-placeholder-internal",
      resourceId: placeholder.id,
      activityId: internalActivity.id,
      projectId: null,
    });
    const templateTimeOff = fixture(source.timeOff[0], "time-off row");
    source.timeOff.push({ ...templateTimeOff, id: "to-placeholder", resourceId: placeholder.id });
    const archived = fixture(source.projects[0], "project");
    archived.archivedAt = archived.updatedAt;
    const built = buildBetaExport(source, { accountId, completeness: "full" });
    const parsed = parseBetaExport(serializeBetaExport(built));
    const prepared = prepareBetaImport(parsed, context);
    expect(prepared.data).toEqual(built.data);
    expect(buildBetaExport(prepared.data, { accountId, completeness: "full" }).data).toEqual(built.data);
    expect(prepared.imported).toBe(APP_DATA_KEYS.reduce((n, key) => n + built.data[key].length, 0));
    expect(parsed.format).toBe(BETA_EXPORT_FORMAT);
    expect(parsed.schemaVersion).toBe(BETA_EXPORT_SCHEMA_VERSION);
    expect(parsed.data.accounts[0]?.id).toBe(accountId);
    expect(built.data.closures).toHaveLength(1);
    expect(built.data.clients.find((row) => row.id === privateClient.id)?.codeName).toBe("Project Bat");
    expect(built.data.projects.find((row) => row.id === privateProject.id)?.codeName).toBe("Project Bat Project");
  });

  it("projects named portable fields while preserving source objects", () => {
    const source = structuredClone(original) as typeof original & {
      resources: Array<(typeof original.resources)[number] & { Vine?: string }>;
    };
    fixture(source.resources[0], "resource").Vine = "secret future property";
    const exported = buildBetaExport(source, { accountId, completeness: "full" });
    expect(exported.data.resources[0]).not.toHaveProperty("Vine");
    expect(source.resources[0]).toHaveProperty("Vine", "secret future property");
  });

  it("rejects malformed data, missing nullable fields, duplicates, wrong scope and unsupported wrappers", () => {
    const document = buildBetaExport(original, { accountId, completeness: "full" });
    const cases: Array<[string, (doc: typeof document) => void]> = [
      [
        "date",
        (doc) => {
          fixture(doc.data.allocations[0], "allocation").startDate = "2026-02-30";
        },
      ],
      [
        "enum",
        (doc) => {
          fixture(doc.data.allocations[0], "allocation").status = "maybe" as never;
        },
      ],
      [
        "field",
        (doc) => {
          delete (doc.data.accounts[0] as Partial<(typeof doc.data.accounts)[0]>).dateStyle;
        },
      ],
      [
        "duplicate",
        (doc) => {
          doc.data.clients.push({ ...fixture(doc.data.clients[0], "client") });
        },
      ],
      [
        "scope",
        (doc) => {
          fixture(doc.data.resources[0], "resource").accountId = "other-account";
        },
      ],
      [
        "reference",
        (doc) => {
          fixture(doc.data.projects[0], "project").clientId = "missing";
        },
      ],
      [
        "identifier",
        (doc) => {
          fixture(doc.data.resources[0], "resource").id = "resource id";
        },
      ],
      [
        "avatar URL",
        (doc) => {
          fixture(
            doc.data.resources.find((row) => row.kind === "person"),
            "person resource",
          ).avatarUrl = "https://user:pass@example.test/avatar.png";
        },
      ],
    ];
    for (const [name, corrupt] of cases) {
      const changed = structuredClone(document);
      corrupt(changed);
      expect(() => prepareBetaImport(changed, context), name).toThrow(BetaTransferError);
    }
    expect(() => parseBetaExport(JSON.stringify({ schemaVersion: 24, data: original }))).toThrow(BetaTransferError);
  });

  it("accepts zero-hour planning allocations and keeps external resources on their domain defaults", () => {
    const source = structuredClone(original);
    fixture(source.allocations[0], "allocation").hoursPerDay = 0;
    const document = buildBetaExport(source, { accountId, completeness: "full" });
    expect(document.data.allocations.find(({ id }) => id === source.allocations[0]?.id)?.hoursPerDay).toBe(0);
    const external = document.data.resources.find(({ kind }) => kind === "external");
    expect(external?.workingHoursPerDay).toBe(8);
    const externalBooking = source.allocations.find(
      (row) => source.resources.find((resource) => resource.id === row.resourceId)?.kind === "external",
    );
    if (!externalBooking) throw new Error("Expected the fixture external allocation");
    externalBooking.hoursPerDay = 1;
    expect(() => buildBetaExport(source, { accountId, completeness: "full" })).toThrow(/zero hours/i);
  });

  it("refuses serializer input containing a row from another account", () => {
    const document = buildBetaExport(original, { accountId, completeness: "full" });
    const foreign = fixture(
      original.resources.find(({ accountId: owner }) => owner !== accountId),
      "foreign resource",
    );
    document.data.resources.push(structuredClone(foreign));
    expect(() => serializeBetaExport(document)).toThrow(/accountId/i);
  });

  it("keeps malformed JSON errors display-safe while retaining the parser cause", () => {
    let error: unknown;
    try {
      parseBetaExport('{"private":"do not echo"');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BetaTransferError);
    expect((error as Error).message).not.toContain("do not echo");
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });

  it("requires a full export and exact account scope, and rejects redacted imports", () => {
    const redacted = buildBetaExport(original, { accountId, completeness: "redacted" });
    expect(() => prepareBetaImport(redacted, context)).toThrow(/full/i);
    const otherScope = { ...context, accountId: "different" };
    expect(() => prepareBetaImport(buildBetaExport(original, { accountId, completeness: "full" }), otherScope)).toThrow(
      BetaTransferError,
    );
  });

  it("serializes a caller-projected redacted document without inventing names or exposing code names", () => {
    const source = structuredClone(original);
    const privateClient = fixture(
      source.clients.find((row) => row.builtin !== true),
      "non-Internal client",
    );
    privateClient.isPrivate = true;
    privateClient.name = "Private alias";
    privateClient.codeName = null;
    const redacted = buildBetaExport(source, { accountId, completeness: "redacted" });
    const json = serializeBetaExport(redacted);
    expect(json).toContain('"name": "Private alias"');
    expect(json).not.toContain("Private name");
    expect(parseBetaExport(json).data.clients.find((row) => row.id === privateClient.id)?.codeName).toBeNull();
  });

  it("rejects an imported member link to a non-person resource", () => {
    const document = buildBetaExport(original, { accountId, completeness: "full" });
    const external = document.data.resources.find((row) => row.kind === "external");
    if (!external) throw new Error("Expected the fixture external resource");
    expect(() =>
      prepareBetaImport(document, {
        accountId,
        memberResourceLinks: [{ memberId: "member", resourceId: external.id }],
      }),
    ).toThrow(/resource/i);
  });

  it("requires placeholder bookings to resolve to their bound project", () => {
    const document = buildBetaExport(original, { accountId, completeness: "full" });
    const placeholder = document.data.resources.find((row) => row.kind === "placeholder");
    const differentProjectActivity = document.data.activities.find(
      (row) => row.kind === "project" && row.projectId !== placeholder?.projectId,
    );
    const booking = document.data.allocations.find((row) => row.resourceId === placeholder?.id);
    if (!placeholder || !differentProjectActivity || !booking)
      throw new Error("Expected a placeholder fixture booking");
    booking.activityId = differentProjectActivity.id;
    booking.projectId = null;
    expect(() => prepareBetaImport(document, context)).toThrow(/bound project/i);
  });

  it("rejects missing Internal client and dangling member resource links without mutation", () => {
    const document = buildBetaExport(original, { accountId, completeness: "full" });
    document.data.clients = document.data.clients.filter((row) => row.builtin !== true);
    const before = structuredClone(document);
    expect(() => prepareBetaImport(document, context)).toThrow(/Internal/i);
    expect(document).toEqual(before);
    const valid = buildBetaExport(original, { accountId, completeness: "full" });
    expect(() =>
      prepareBetaImport(valid, { ...context, memberResourceLinks: [{ memberId: "m", resourceId: "nope" }] }),
    ).toThrow(/resource/i);
  });
});
