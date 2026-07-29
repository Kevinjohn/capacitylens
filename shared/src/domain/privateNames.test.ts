import { describe, expect, it } from "vitest";
import { emptyAppData, type Client, type Project } from "../types/entities";
import {
  normalizeCodeName,
  nameForQuotedContext,
  privateCodeNameFallback,
  quoteCodeName,
  redactPrivateName,
  redactPrivateNames,
} from "./privateNames";

const meta = { accountId: "a1", createdAt: "t", updatedAt: "t" };
const privateClient: Client = {
  ...meta,
  id: "c1",
  name: "Real Client",
  color: "#112233",
  isPrivate: true,
  codeName: "Northstar",
};
const privateProject: Project = {
  ...meta,
  id: "p1",
  name: "Real Project",
  clientId: "c1",
  color: "#445566",
  isPrivate: true,
  codeName: "Aurora",
};

describe("private-name projection", () => {
  it("stores code names without user-supplied outer quotes and displays one consistent quote pair", () => {
    expect(normalizeCodeName("  “Northstar”  ")).toBe("Northstar");
    expect(normalizeCodeName("““  Northstar  ””")).toBe("Northstar");
    expect(normalizeCodeName('North"star')).toBe('North"star');
    expect(quoteCodeName('"Northstar"')).toBe('"Northstar"');
    expect(nameForQuotedContext('"Northstar"')).toBe("Northstar");
  });

  it("redacts a private row without mutating it and removes the raw codeName field", () => {
    const redacted = redactPrivateName(privateClient);
    expect(redacted.name).toBe('"Northstar"');
    expect(redacted).not.toHaveProperty("codeName");
    expect(privateClient).toMatchObject({ name: "Real Client", codeName: "Northstar" });
  });

  it("is idempotent for both a projected row and a projected slice", () => {
    const once = redactPrivateName(privateClient);
    expect(redactPrivateName(once)).toBe(once);
    expect(redactPrivateName(once).name).toBe('"Northstar"');

    const data = { ...emptyAppData(), clients: [privateClient], projects: [privateProject] };
    const projected = redactPrivateNames(data);
    const projectedAgain = redactPrivateNames(projected);
    expect(projectedAgain.clients[0].name).toBe('"Northstar"');
    expect(projectedAgain.projects[0].name).toBe('"Aurora"');
  });

  it("fails closed to a neutral code name when a private row has no usable code name", () => {
    const malformed = { ...privateClient, name: "Secret Real Name", codeName: undefined };
    const redacted = redactPrivateName(malformed);
    expect(redacted.name).toBe('"Confidential #c1"');
    expect(redacted.name).not.toContain("Secret Real Name");
    expect(redacted).not.toHaveProperty("codeName");
  });

  it("fails closed instead of throwing when an untrusted private row has a non-string code name", () => {
    const malformed = { ...privateClient, codeName: 42 } as unknown as Client;
    expect(redactPrivateName(malformed).name).toBe('"Confidential #c1"');
  });

  it.each([1, "true", "yes"])("fails closed for a truthy non-boolean privacy flag (%j)", (isPrivate) => {
    const malformed = { ...privateClient, isPrivate } as unknown as Client;
    const redacted = redactPrivateName(malformed);
    expect(redacted.name).toBe('"Northstar"');
    expect(redacted).not.toHaveProperty("codeName");
  });

  it("derives distinct stable fallbacks from record ids without using private names", () => {
    expect(privateCodeNameFallback("client-1234")).toBe("Confidential #client1234");
    expect(privateCodeNameFallback("client-5678")).toBe("Confidential #client5678");
    expect(privateCodeNameFallback("----")).toBe("Confidential #0000");
  });

  it("redacts only clients and projects, leaving public names and all other tables untouched", () => {
    const publicClient = {
      ...privateClient,
      id: "c2",
      name: "Public Client",
      isPrivate: undefined,
      codeName: undefined,
    };
    const data = {
      ...emptyAppData(),
      clients: [privateClient, publicClient],
      projects: [privateProject],
    };
    const visible = redactPrivateNames(data);
    expect(visible.clients.map((c) => c.name)).toEqual(['"Northstar"', "Public Client"]);
    expect(visible.projects[0].name).toBe('"Aurora"');
    expect(visible.accounts).toBe(data.accounts);
  });
});
