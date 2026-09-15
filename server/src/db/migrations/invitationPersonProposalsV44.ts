import { INVITATION_PERSON_PROPOSALS_SQL } from "../../controlTables/invitationPersonProposals";
import { defineMigration } from "../migrationLedger";

/** Immutable v44 app-owned invitation proposal and current-link exception tables. */
export const INVITATION_PERSON_PROPOSALS_V44_MIGRATION = defineMigration(
  44,
  "add-invitation-person-proposals",
  ["control-table:no-foreign-keys:v1", INVITATION_PERSON_PROPOSALS_SQL].join("\n-- migration component --\n"),
  (db) => db.exec(INVITATION_PERSON_PROPOSALS_SQL),
);

export const INVITATION_PERSON_PROPOSALS_V44_PIN = {
  version: INVITATION_PERSON_PROPOSALS_V44_MIGRATION.version,
  name: INVITATION_PERSON_PROPOSALS_V44_MIGRATION.name,
  checksum: INVITATION_PERSON_PROPOSALS_V44_MIGRATION.checksum,
};
