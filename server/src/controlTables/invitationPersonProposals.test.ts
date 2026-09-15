import { describe, expect, it } from "vitest";
import { createInvite, ensureAccountMemberResources, newInviteId } from "../controlTables";
import { openDb } from "../db";
import {
  createInvitationPersonProposal,
  getMemberResourceLinkException,
  getInvitationPersonProposal,
  listInvitationPersonProposals,
  listMemberResourceLinkExceptions,
  settleInvitationPersonProposal,
} from "./invitationPersonProposals";

const TS = "2026-01-01T00:00:00.000Z";

function fixture() {
  const db = openDb(":memory:");
  db.prepare(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`).run(
    "a1",
    "Wayne Enterprises",
    "#000000",
    TS,
    TS,
  );
  db.prepare(
    `INSERT INTO resources
      (id, accountId, kind, name, role, employmentType, workingHoursPerDay, workingDays, color, createdAt, updatedAt)
     VALUES (?, ?, 'person', ?, ?, 'employee', 8, '[]', '#000000', ?, ?)`,
  ).run("r1", "a1", "Clark Kent", "Developer", TS, TS);
  db.prepare(
    `INSERT INTO account_members (accountId, userId, role, status, createdAt) VALUES (?, ?, 'editor', 'active', ?)`,
  ).run("a1", "u1", TS);
  ensureAccountMemberResources(db);
  return db;
}

function invite(db: ReturnType<typeof openDb>, id = "i1") {
  createInvite(db, {
    token: `token-${id}`,
    id,
    accountId: "a1",
    role: "editor",
    preauthEmail: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    usedAt: null,
    createdAt: TS,
  });
}

describe("invitation person proposals", () => {
  it("fails closed when a current-schema proposal table is damaged", () => {
    const db = fixture();
    db.exec(`DROP TABLE invitation_person_proposals`);
    expect(() => listInvitationPersonProposals(db, "a1")).toThrow(/no such table/i);
    db.close();
  });

  it("stores a minimal, account-scoped non-reserving proposal", () => {
    const db = fixture();
    invite(db);
    createInvitationPersonProposal({ db, invitationId: "i1", accountId: "a1", resourceId: "r1", now: TS });
    expect(getInvitationPersonProposal(db, "i1")).toMatchObject({
      invitationId: "i1",
      accountId: "a1",
      resourceId: "r1",
      createdAt: TS,
      updatedAt: TS,
    });
    expect(db.prepare(`SELECT * FROM account_member_resources`).all()).toEqual([]);
    db.close();
  });

  it("links an eligible target and consumes the proposal in the admission transaction", () => {
    const db = fixture();
    invite(db);
    createInvitationPersonProposal({ db, invitationId: "i1", accountId: "a1", resourceId: "r1", now: TS });
    settleInvitationPersonProposal({ db, invitationId: "i1", accountId: "a1", userId: "u1", now: TS });
    expect(db.prepare(`SELECT userId, resourceId FROM account_member_resources`).all()).toEqual([
      { userId: "u1", resourceId: "r1" },
    ]);
    expect(getInvitationPersonProposal(db, "i1")).toBeNull();
    expect(listMemberResourceLinkExceptions(db, "a1")).toEqual([]);
    db.close();
  });

  it.each([
    ["occupied", "r1", "resource_already_linked"],
    ["already-linked", "r1", "member_already_linked"],
    ["unavailable", "r1", "resource_unavailable"],
  ] as const)("records the bounded %s outcome", (_label, resourceId, reason) => {
    const db = fixture();
    invite(db);
    if (reason === "resource_already_linked") {
      db.prepare(
        `INSERT INTO account_member_resources (accountId, userId, resourceId, revision, createdAt, updatedAt)
         VALUES ('a1', 'other', 'r1', ?, ?, ?)`,
      ).run(newInviteId(), TS, TS);
    }
    if (reason === "member_already_linked") {
      db.prepare(
        `INSERT INTO account_member_resources (accountId, userId, resourceId, revision, createdAt, updatedAt)
         VALUES ('a1', 'u1', 'r2', ?, ?, ?)`,
      ).run(newInviteId(), TS, TS);
    }
    createInvitationPersonProposal({ db, invitationId: "i1", accountId: "a1", resourceId, now: TS });
    if (reason === "resource_unavailable") db.prepare(`UPDATE resources SET archivedAt = ? WHERE id = 'r1'`).run(TS);
    settleInvitationPersonProposal({ db, invitationId: "i1", accountId: "a1", userId: "u1", now: TS });
    expect(getMemberResourceLinkException(db, "a1", "u1")).toMatchObject({ reason, proposedResourceId: "r1" });
    expect(getInvitationPersonProposal(db, "i1")).toBeNull();
    db.close();
  });
});
