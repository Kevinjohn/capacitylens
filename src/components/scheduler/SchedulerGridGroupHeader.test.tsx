import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { m } from "@/i18n";
import { makeResource } from "../../test/fixtures";
import type { ColumnGeometry } from "./columnGeometry";
import { buildSchedulerDensity } from "./layout";
import type { GroupModel, RowModel } from "./schedulerModel";
import { SchedulerGridGroupHeader } from "./SchedulerGridGroupHeader";

function makeRow(id: string, utilization: number, kind: RowModel["resource"]["kind"] = "person"): RowModel {
  return {
    resource: makeResource({ id, kind }),
    rowHeight: 40,
    bars: [],
    dayStates: [],
    conflictDayCount: 0,
    partialCapacityDayCount: 0,
    timeOff: [],
    utilization,
    overSoon: false,
    dimmed: false,
  };
}

function renderGroup(rows: RowModel[], external = false) {
  const group: GroupModel = { key: "design", title: "Design", external, rows };
  render(
    <SchedulerGridGroupHeader
      group={group}
      rowIndex={1}
      ui={{ collapsedGroups: [] }}
      density={buildSchedulerDensity({ compact: false })}
      toggleGroup={() => {}}
      geom={{ totalWidth: 700 } as ColumnGeometry}
      utilizationPrefs={{ showTotal: true, showDiscipline: true, showPersonal: true }}
    />,
  );
  return screen.getByTestId("discipline-group");
}

it("averages only capacity-tracked rows, as the headline does", () => {
  const header = renderGroup([makeRow("r1", 0.8), makeRow("r2", 0.8), makeRow("r3", 0, "external")]);
  expect(header).toHaveTextContent(m.scheduler_group_avg_utilisation({ percent: "80" }));
});

it("shows no average when no capacity-tracked row remains", () => {
  const header = renderGroup([makeRow("r3", 0, "external")]);
  expect(header).not.toHaveTextContent(/avg utilisation/);
});

it("shows no average for the external band", () => {
  const header = renderGroup([makeRow("r3", 0, "external")], true);
  expect(header).not.toHaveTextContent(/avg utilisation/);
});
