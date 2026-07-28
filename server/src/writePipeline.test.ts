import { emptyAppData } from "@capacitylens/shared/types/entities";
import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { replaceGeneratedBuiltin } from "./writePipeline";

describe("transaction-only write helpers", () => {
  it("refuses to replace the generated Internal client outside an existing transaction", () => {
    const db = openDb(":memory:");

    expect(() => replaceGeneratedBuiltin(db, emptyAppData(), "internal:a1", {})).toThrow(
      "Internal-client replacement must run inside an existing transaction.",
    );
    db.close();
  });
});
