import type { AppData } from "../../types/entities";
import { TS, STUDIO } from "./constants";

export function createSchedule(): Pick<AppData, "timeOff" | "closures"> {
  return {
    timeOff: [
      {
        id: "to-tyler",
        accountId: STUDIO,
        createdAt: TS,
        updatedAt: TS,
        resourceId: "r-tyler",
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        type: "holiday",
        note: "Long weekend",
      },
    ],
    closures: [],
  };
}
