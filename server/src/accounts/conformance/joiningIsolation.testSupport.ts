import * as joiningIntents from "../../controlTables/joiningIntents";
import * as joiningPolicies from "../../controlTables/joiningPolicies";

export const joiningModules = { joiningIntents, joiningPolicies };

/** Account-scoped operations have dedicated cross-company probes in joiningIsolation.conformance.test.ts. */
export const joiningExclusions: Array<[string, string]> = [
  ["joiningPolicies.readJoiningPolicy", "read"],
  ["joiningPolicies.writeJoiningPolicy", "account isolation tested in joiningIsolation.conformance.test.ts"],
  ["joiningPolicies.removeJoiningPolicy", "account isolation tested in joiningIsolation.conformance.test.ts"],
  ["joiningIntents.removeJoinIntentsForAccount", "account isolation tested in joiningIsolation.conformance.test.ts"],
  ["joiningIntents.readJoinIntent", "read"],
  ["joiningIntents.pruneJoinIntents", "global expired-intent maintenance by design"],
  ["joiningIntents.insertJoinIntent", "inserts one globally unique intent; cannot overwrite another account's row"],
  ["joiningIntents.reserveJoinDelivery", "intent-id keyed; caller supplies the browser-bound intent"],
  ["joiningIntents.clearFailedJoinDelivery", "intent-id, generation and token keyed"],
  ["joiningIntents.approveJoinToken", "browser nonce and mailbox token keyed"],
  [
    "joiningIntents.completeJoinIntent",
    "intent-id keyed; admission separately checks its company in the same transaction",
  ],
  ["joiningIntents.cancelJoinIntent", "browser nonce keyed"],
];
