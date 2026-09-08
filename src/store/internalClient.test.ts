import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { internalClientFor } from "@capacitylens/shared/data/internalClient";

const s = () => useStore.getState();

function expectPresent<T>(value: T | null | undefined, message: string): T {
  expect(value).toBeDefined();
  if (value == null) throw new Error(message);
  return value;
}

function addsAccountWithBuiltinClient(): void {
  const a = expectPresent(
    s().addAccount({ name: "Acme Co", color: "#6366f1" }),
    "Expected the test account to be created.",
  );
  const internal = s().data.clients.filter((c) => c.builtin && c.accountId === a.id);
  expect(internal).toHaveLength(1);
  expect(internal[0]?.name).toBe("Internal");
  // A second account gets its OWN Internal (one per account).
  const b = expectPresent(
    s().addAccount({ name: "Beta Co", color: "#111111" }),
    "Expected the second test account to be created.",
  );
  expect(s().data.clients.filter((c) => c.builtin)).toHaveLength(2);
  expect(internalClientFor(s().data.clients, b.id)).toBeDefined();
}

function rejectsBuiltinRename(): void {
  const a = expectPresent(
    s().addAccount({ name: "Acme Co", color: "#6366f1" }),
    "Expected the test account to be created.",
  );
  s().setActiveAccount(a.id);
  const internal = expectPresent(
    internalClientFor(s().data.clients, a.id),
    "Expected the built-in client to be present.",
  );
  expect(() => s().updateClient(internal.id, { name: "Renamed" })).toThrow(/built in/i);
  // Unchanged.
  const unchanged = expectPresent(
    internalClientFor(s().data.clients, a.id),
    "Expected the built-in client to remain present.",
  );
  expect(unchanged.name).toBe("Internal");
}

function renamesNormalClient(): void {
  const a = expectPresent(
    s().addAccount({ name: "Acme Co", color: "#6366f1" }),
    "Expected the test account to be created.",
  );
  s().setActiveAccount(a.id);
  const c = s().addClient({ name: "Globex", color: "#3b82f6" });
  s().updateClient(c.id, { name: "Globex 2" });
  const renamed = expectPresent(
    s().data.clients.find((x) => x.id === c.id),
    "Expected the renamed client to be present.",
  );
  expect(renamed.name).toBe("Globex 2");
}

function stripsAddedBuiltinFlag(): void {
  const a = expectPresent(
    s().addAccount({ name: "Acme Co", color: "#6366f1" }),
    "Expected the test account to be created.",
  );
  s().setActiveAccount(a.id);
  // A cast payload smuggling builtin:true must NOT mint a second Internal — the store strips it.
  const c = s().addClient({ name: "Sneaky", color: "#3b82f6", builtin: true } as never);
  const sneaky = expectPresent(
    s().data.clients.find((x) => x.id === c.id),
    "Expected the added client to be present.",
  );
  expect(sneaky.builtin).not.toBe(true);
  // Still exactly one builtin Internal for the account (addAccount's), not two.
  expect(s().data.clients.filter((x) => x.builtin && x.accountId === a.id)).toHaveLength(1);
}

function stripsPromotedBuiltinFlag(): void {
  const a = expectPresent(
    s().addAccount({ name: "Acme Co", color: "#6366f1" }),
    "Expected the test account to be created.",
  );
  s().setActiveAccount(a.id);
  const c = s().addClient({ name: "Globex", color: "#3b82f6" });
  s().updateClient(c.id, { builtin: true } as never);
  const promoted = expectPresent(
    s().data.clients.find((x) => x.id === c.id),
    "Expected the promoted client to be present.",
  );
  expect(promoted.builtin).not.toBe(true);
  // No second builtin appeared for the account.
  expect(s().data.clients.filter((x) => x.builtin && x.accountId === a.id)).toHaveLength(1);
}

describe("built-in Internal client in the store", () => {
  beforeEach(() => s().replaceAll(emptyAppData()));

  it("addAccount creates exactly one builtin Internal client for the new account", addsAccountWithBuiltinClient);
  it("rejects renaming the built-in Internal client", rejectsBuiltinRename);
  // The builtin Internal client's protection from REMOVAL is now exercised through the lifecycle
  // actions (archive/softDelete/purge all throw "built in") in useStore.lifecycle.test.ts — there is
  // no immediate deleteClient action anymore. This file keeps the RENAME guard, which is the
  // updateClient concern that stays here.
  it("still allows renaming a normal client", renamesNormalClient);
  it(
    "addClient cannot create a SECOND builtin — the flag is stripped (one Internal per account)",
    stripsAddedBuiltinFlag,
  );
  it("updateClient cannot PROMOTE a normal client to a builtin — the flag is stripped", stripsPromotedBuiltinFlag);
});
