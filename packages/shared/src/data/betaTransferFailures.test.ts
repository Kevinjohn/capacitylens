import { describe, expect, it } from "vitest";
import { seed } from "./seed.js";
import { BetaTransferError, buildBetaExport, parseBetaExport, prepareBetaImport } from "./betaTransfer.js";
import { APP_DATA_KEYS } from "../types/entities.js";
import type { AppDataKey } from "../types/entities.js";
import type { BetaExportDocument } from "./betaTransfer.js";

function requireValue<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("The complete beta fixture is missing a required row.");
  return value;
}

const context = { accountId: "a-studio", memberResourceLinks: [] };
const freshDocument = () => {
  const source = seed();
  const account = requireValue(source.accounts.find((row) => row.id === context.accountId));
  source.closures.push({
    id: "gotham-closure",
    accountId: context.accountId,
    name: "Gotham holiday",
    startDate: "2026-12-25",
    endDate: "2026-12-25",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  });
  return buildBetaExport(source, { accountId: context.accountId, completeness: "full" });
};
type CorruptDocument = (document: BetaExportDocument) => void;

const failures: [string, CorruptDocument][] = [
  [
    "zero-capacity placeholders",
    (doc) => {
      requireValue(doc.data.resources.find((row) => row.kind === "placeholder")).workingHoursPerDay = 0;
    },
  ],
  [
    "supplementary placeholders",
    (doc) => {
      requireValue(doc.data.resources.find((row) => row.kind === "placeholder")).engagement = "supplementary";
    },
  ],
  [
    "external discipline links",
    (doc) => {
      requireValue(doc.data.resources.find((row) => row.kind === "external")).disciplineId = requireValue(
        doc.data.disciplines[0],
      ).id;
    },
  ],
  ...(["placeholder", "external"] as const).flatMap((kind) =>
    (["firstAvailableDate", "lastAvailableDate"] as const).map((field): [string, CorruptDocument] => [
      `${kind} ${field}`,
      (doc) => {
        requireValue(doc.data.resources.find((row) => row.kind === kind))[field] = "2026-10-20";
      },
    ]),
  ),
  [
    "numeric strings",
    (doc) => {
      Object.assign(requireValue(doc.data.allocations[0]), { hoursPerDay: "8" });
    },
  ],
  [
    "control characters in identifiers",
    (doc) => {
      requireValue(doc.data.clients[0]).id = "client\u0000id";
    },
  ],
  [
    "non-finite values",
    (doc) => {
      requireValue(doc.data.allocations[0]).hoursPerDay = Infinity;
    },
  ],
  [
    "invalid timestamps",
    (doc) => {
      requireValue(doc.data.clients[0]).updatedAt = "2026-02-30T12:00:00Z";
    },
  ],
  [
    "reversed date ranges",
    (doc) => {
      requireValue(doc.data.allocations[0]).endDate = "2020-01-01";
    },
  ],
  [
    "boolean strings",
    (doc) => {
      Object.assign(requireValue(doc.data.accounts[0]), { placeholdersEnabled: "false" });
    },
  ],
  [
    "unsupported time zones",
    (doc) => {
      requireValue(doc.data.accounts[0]).timezone = "Gotham/Invalid";
    },
  ],
  [
    "repeated weekdays",
    (doc) => {
      requireValue(doc.data.resources[0]).workingDays = [1, 1];
    },
  ],
  [
    "half days outside working days",
    (doc) => {
      requireValue(doc.data.resources[0]).workingDays = [1];
      requireValue(doc.data.resources[0]).halfDays = [2];
    },
  ],
  [
    "unsafe avatars",
    (doc) => {
      requireValue(doc.data.resources[0]).avatarUrl = "https://bruce:secret@wayne.example/avatar.png";
    },
  ],
  [
    "unsupported text",
    (doc) => {
      requireValue(doc.data.accounts[0]).name = "Wayne\u0000Enterprises";
    },
  ],
  [
    "a missing phase project",
    (doc) => {
      requireValue(doc.data.phases[0]).projectId = "missing-project";
    },
  ],
  [
    "activity kind/reference disagreement",
    (doc) => {
      requireValue(doc.data.activities[0]).kind = "internal";
      requireValue(doc.data.activities[0]).projectId = requireValue(doc.data.projects[0]).id;
    },
  ],
  [
    "a missing allocation activity",
    (doc) => {
      requireValue(doc.data.allocations[0]).activityId = "missing-activity";
    },
  ],
  [
    "a missing time-off resource",
    (doc) => {
      requireValue(doc.data.timeOff[0]).resourceId = "missing-resource";
    },
  ],
  [
    "private Internal",
    (doc) => {
      requireValue(doc.data.clients.find((row) => row.builtin)).isPrivate = true;
    },
  ],
  [
    "renamed Internal",
    (doc) => {
      requireValue(doc.data.clients.find((row) => row.builtin)).name = "Wayne Enterprises";
    },
  ],
  [
    "duplicate Internal",
    (doc) => {
      const row = requireValue(doc.data.clients.find((row) => row.builtin));
      doc.data.clients.push({ ...row, id: "second-internal" });
    },
  ],
  [
    "a full private name without a code name",
    (doc) => {
      const row = requireValue(doc.data.clients.find((row) => !row.builtin));
      row.isPrivate = true;
      row.codeName = null;
    },
  ],
];

describe("Beta transfer failure boundaries", () => {
  it.each(["clients", "projects"] as const)("retains the full-export name limit for %s", (key) => {
    const document = freshDocument();
    const row = requireValue(
      document.data[key].find((item) => key !== "clients" || !("builtin" in item && item.builtin)),
    );
    row.name = "N".repeat(101);
    expect(() => prepareBetaImport(document, context)).toThrow(/name/);
  });

  it("does not expand the public-name limit for redacted documents", () => {
    const document = { ...freshDocument(), completeness: "redacted" as const };
    const row = requireValue(document.data.clients.find((item) => !item.builtin));
    row.name = "N".repeat(101);
    row.isPrivate = false;
    expect(() => parseBetaExport(JSON.stringify(document))).toThrow(/name/);
  });

  it.each(["closure/one", "_closure", "götham", "x".repeat(129)])(
    "refuses identifiers outside the typed planning route contract: %s",
    (id) => {
      const document = freshDocument();
      requireValue(document.data.closures[0]).id = id;
      expect(() => prepareBetaImport(document, context)).toThrow(/id/);
    },
  );

  it("preserves the longest stable identifier accepted by typed planning routes", () => {
    const document = freshDocument();
    const id = `G${"a._~-9".repeat(21)}0`;
    expect(id).toHaveLength(128);
    requireValue(document.data.closures[0]).id = id;
    expect(prepareBetaImport(document, context).data.closures[0]?.id).toBe(id);
  });

  it.each(failures)("refuses %s without changing the supplied replacement", (_name, corrupt) => {
    const document = freshDocument();
    corrupt(document);
    const before = structuredClone(document);
    expect(() => prepareBetaImport(document, context)).toThrow(BetaTransferError);
    expect(document).toEqual(before);
  });

  it.each(APP_DATA_KEYS)("rejects duplicate IDs in %s", (key) => {
    const document = freshDocument();
    const rows = document.data[key] as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(0);
    rows.push({ ...requireValue(rows[0]) });
    expect(() => prepareBetaImport(document, context)).toThrow(/duplicates/i);
  });

  it.each([0, 2, "1", null, undefined])("rejects unsupported beta version %s", (schemaVersion) => {
    const document = { ...freshDocument(), schemaVersion };
    expect(() => parseBetaExport(JSON.stringify(document))).toThrow(/schemaVersion/);
  });

  it.each(APP_DATA_KEYS)("requires the complete %s table", (key: AppDataKey) => {
    const document = freshDocument();
    delete (document.data as Partial<typeof document.data>)[key];
    expect(() => prepareBetaImport(document, context)).toThrow(new RegExp(`data.${key}`));
  });

  it("cannot supply destination scope or member links through document extras", () => {
    const document = { ...freshDocument(), accountId: "a-loft", memberResourceLinks: [] };
    expect(() =>
      prepareBetaImport(document, {
        accountId: "a-studio",
        memberResourceLinks: [{ memberId: "bruce-member", resourceId: "missing-person" }],
      }),
    ).toThrow(/missing-person/);
    expect(() => prepareBetaImport(document, undefined as never)).toThrow(/context/);
  });

  it("returns independent rows and working-day arrays for a prepared replacement", () => {
    const document = freshDocument();
    const before = structuredClone(document);
    const prepared = prepareBetaImport(document, context);
    requireValue(prepared.data.accounts[0]).name = "Gotham Studio";
    requireValue(prepared.data.resources[0]).workingDays.push(0);
    expect(document).toEqual(before);
  });

  it("projects authority and device fields away rather than importing them", () => {
    const document = freshDocument();
    const input = {
      ...document,
      identities: [{ id: "bruce-identity" }],
      sessions: [{ token: "must-not-survive" }],
      memberships: [{ role: "owner" }],
      activeAccountId: "a-loft",
    };
    Object.assign(requireValue(input.data.accounts[0]), { admissionPolicy: "open", role: "owner", theme: "dark" });
    const prepared = prepareBetaImport(input, context);
    expect(prepared.data).toEqual(freshDocument().data);
    expect(JSON.stringify(prepared)).not.toContain("must-not-survive");
    expect(prepared.data.accounts[0]).not.toHaveProperty("admissionPolicy");
    expect(prepared.data.accounts[0]).not.toHaveProperty("role");
    expect(prepared.data.accounts[0]).not.toHaveProperty("theme");
  });
});
