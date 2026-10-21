import { describe, it, expect } from "vitest";
import { parseData, serializeData } from "./transfer.js";
import { seed } from "./seed.js";
import { EXPORT_SCHEMA_VERSION } from "../types/entities.js";

describe("data transfer", () => {
  it("round-trips through serialize -> parse (deep equal)", () => {
    const data = seed();
    const serialized = serializeData(data);
    const parsed = JSON.parse(serialized) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(parseData(serialized)).toEqual(data);
  });

  it("exports every nullable entity field as an explicit null after v23 migration", () => {
    const data = seed();
    const parsed = parseData(JSON.stringify({ schemaVersion: 23, data }));
    const account = parsed.accounts[0];
    const person = parsed.resources.find(({ kind }) => kind === "person");
    const booking = parsed.allocations[0];
    expect(account).toHaveProperty("timezone");
    expect(account?.timezone).toBeNull();
    expect(person).toHaveProperty("avatarUrl");
    expect(person?.avatarUrl).toBeNull();
    expect(booking).toHaveProperty("note");
    expect(booking?.note).toBeNull();
  });

  it("migrates a v23 person avatar URL to v24", () => {
    // Pin the complete export history: v23 is the first schema that carries person avatar URLs.
    const data = seed();
    const person = data.resources.find(({ kind }) => kind === "person");
    if (!person) throw new Error("Expected a person in the export fixture");
    person.avatarUrl = "https://images.example/bruce.png";

    const serialized = JSON.stringify({ schemaVersion: 23, data });
    expect(parseData(serialized).resources.find(({ id }) => id === person.id)?.avatarUrl).toBe(person.avatarUrl);
  });

  it("rejects JSON that is not CapacityLens-shaped (so import never silently wipes data)", () => {
    expect(() => parseData("[1,2,3]")).toThrow(/not CapacityLens data/i);
    expect(() => parseData('{"data":5}')).toThrow(/not CapacityLens data/i);
    expect(() => parseData("5")).toThrow(/not CapacityLens data/i);
    expect(() => parseData('{"foo":"bar"}')).toThrow(/not CapacityLens data/i);
    expect(() => parseData('"hello"')).toThrow(/not CapacityLens data/i);
    expect(() => parseData('{"resources":"oops"}')).toThrow(/data table is not a list/i);
  });
});

describe("data transfer wrapper validation", () => {
  it.each([
    ["null", null],
    ["string", "not a wrapper"],
    ["array", []],
  ])("rejects outer records when a present data wrapper is %s", (_label, data) => {
    expect(() =>
      parseData(
        JSON.stringify({
          clients: [{ id: "outer-client" }],
          data,
        }),
      ),
    ).toThrow(/not CapacityLens data/i);
  });

  it("reports a known non-list table as damaged CapacityLens data", () => {
    expect(() => parseData(JSON.stringify({ schemaVersion: EXPORT_SCHEMA_VERSION, data: { clients: {} } }))).toThrow(
      /damaged: a data table is not a list/i,
    );
  });
});

describe("data transfer repair", () => {
  it("uses the platform JSON parser for duplicate object keys", () => {
    const imported = parseData(
      '{"schemaVersion":3,"data":{"clients":[{"id":"old","name":"Wayne Applied Sciences"},{"id":"new","name":"Wayne Aerospace"}]},"data":{"clients":[{"id":"new","name":"Wayne Aerospace"}]}}',
    );
    expect(imported.clients.map(({ id }) => id)).toEqual(["new"]);
  });
  it.each([
    ["string", String(10)],
    ["null", null],
    ["fractional", 1.5],
    ["negative", -1],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a present %s schema version before future data can be normalized away", (_label, schemaVersion) => {
    const json = JSON.stringify({
      schemaVersion,
      data: {
        clients: [{ id: "c1", name: "Recognised row" }],
        futureRecords: [{ id: "would-be-lost" }],
      },
    });
    expect(() => parseData(json)).toThrow(/schema version must be a non-negative safe integer/i);
  });

  it("refuses a CapacityLens-shaped file that contains zero records (would silently wipe the account)", () => {
    expect(() => parseData('{"accounts":[],"clients":[],"projects":[]}')).toThrow(/no CapacityLens records/i);
    expect(() => parseData(JSON.stringify({ schemaVersion: 3, data: { clients: [] } }))).toThrow(
      /no CapacityLens records/i,
    );
  });

  it.each([
    ["null", null],
    ["string", "not a record"],
    ["number", 42],
    ["array", []],
  ])("rejects a %s table element with a stable damaged-file error", (_label, row) => {
    expect(() => parseData(JSON.stringify({ clients: [row] }))).toThrow(
      "This file is damaged: the clients table contains an invalid record. Nothing was imported.",
    );
  });

  it("import tolerates a bare AppData and fills any missing arrays", () => {
    const json = JSON.stringify({
      clients: [{ id: "c1", createdAt: "t", updatedAt: "t", name: "A", color: "#1" }],
    });
    const out = parseData(json);
    expect(out.clients).toHaveLength(1);
    expect(out.resources).toEqual([]);
    expect(out.allocations).toEqual([]);
  });
});
