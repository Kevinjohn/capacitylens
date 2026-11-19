import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { SchedulerGrid } from './SchedulerGrid';
import { useStore } from '@/store/useStore';
import type { AppData } from '@capacitylens/shared/types/entities';
import {
  DEFAULT_COMPANY_ID,
  makeClosure,
  makeResource,
  makeTimeOff,
  resetStoreWithData,
} from '@/test/fixtures';
import { schedulerDataset } from '@/test/schedulerTestKit';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import { capacityOver } from '@/test/capacityFixtures';
import { eachDayISO } from '@capacitylens/shared/lib/dateMath';
import { LAYOUT, laneLayout, SCHEDULER_DENSITY, SCHEDULER_LANE_LAYOUT } from './layout';
import { resolveRowHeightForLanes } from '@/lib/lanePacking';
import { buildVisibleSpanInsets } from './visibleSpanInsets';
import { OwnerPermissions } from '@/test/ownerPermissions';

function OwnerRouter({ children }: { children: ReactNode }) {
  return (
    <OwnerPermissions>
      <MemoryRouter>{children}</MemoryRouter>
    </OwnerPermissions>
  );
}

const ACC = DEFAULT_COMPANY_ID;

// SchedulerGrid calls useNavigate (the empty-state "Go to Resources" CTA), so every render must
// sit inside a Router.
function renderGrid() {
  return render(<SchedulerGrid />, { wrapper: OwnerRouter });
}

function scrollSchedulerGridTo(px: number) {
  const grid = screen.getByTestId('scheduler-grid');
  act(() => {
    grid.scrollLeft = px;
    grid.dispatchEvent(new Event('scroll'));
  });
}

function fittedSchedulerGridOffsets() {
  const cells = Array.from(screen.getByTestId('scheduler-day-tier').children) as HTMLElement[];
  const x = (index: number) =>
    cells.slice(0, index).reduce((sum, cell) => sum + Number.parseFloat(cell.style.width), 0);
  return {
    week: x(7),

    nudge: x(9),
    snapped: x(7),
  };
}

function dataset(): AppData {
  return schedulerDataset({
    resources: [
      makeResource({ companyId: ACC, disciplineId: 'd1', name: 'Bruce', color: '#111' }),
      makeResource({
        id: 'r-ext',
        companyId: ACC,
        kind: 'external',
        name: 'Kord Industries',
        role: 'Partner studio',
        color: '#999',
      }),
    ],
  });
}

beforeEach(async () => {
  await resetStoreWithData(dataset(), ACC);
  useStore.getState().setOriginDate('2026-06-01');

  useStore.getState().setZoom(1);
  useStore.getState().setDrawMode('work');
  useStore.getState().setUtilisationPref({ key: 'showTotal', value: true });
  useStore.getState().clearFilters();
  useStore.setState((st) => ({ ui: { ...st.ui, collapsedGroups: [], scrollToResource: null } }));
});

describe('SchedulerGrid', () => {
  it('names the resource column when the optional total utilisation is hidden', () => {
    useStore.getState().setUtilisationPref({ key: 'showTotal', value: false });

    renderGrid();

    expect(screen.getByRole('columnheader', { name: 'Resources' })).toHaveAttribute(
      'aria-colindex',
      '1',
    );
    expect(screen.queryByTestId('overall-utilization')).not.toBeInTheDocument();
  });

  it('positions a bar by start date with inclusive width', () => {
    renderGrid();
    const bar = screen.getByTestId('allocation-bar');

    expect(bar.style.left).toBe(`${LAYOUT.barInset}px`);
    expect(Number.parseInt(bar.style.width, 10)).toBeGreaterThan(0);
    expect(bar).toHaveAttribute('data-status', 'confirmed');
  });
});

describe('SchedulerGrid', () => {
  it('keeps the dragged source mounted while vertical windowing exposes a distant target', async () => {
    const base = dataset();
    const baseResource = base.resources[0];
    const baseAllocation = base.allocations[0];
    expect(baseResource).toBeDefined();
    expect(baseAllocation).toBeDefined();
    if (!baseResource || !baseAllocation) throw new Error('Expected the scheduler fixture rows.');
    const resources = Array.from({ length: 100 }, (_, index) => ({
      ...baseResource,
      id: `r${index}`,
      name: `Person ${index}`,
    }));
    await resetStoreWithData(
      {
        ...base,
        resources,
        allocations: [{ ...baseAllocation, resourceId: 'r0' }],
      },
      ACC,
    );
    useStore.getState().setOriginDate('2026-06-01');
    useStore.getState().setZoom(1);
    useStore.getState().clearFilters();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 180,
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const view = renderGrid();
    try {
      expect(document.querySelector('[data-resource-id="r0"]')).not.toBeNull();
      expect(document.querySelector('[data-resource-id="r99"]')).toBeNull();

      act(() => useStore.setState({ draggingAllocationId: 'a1' }));
      const grid = screen.getByTestId('scheduler-grid');
      act(() => {
        grid.scrollTop = 100_000;
        grid.dispatchEvent(new Event('scroll'));
      });

      expect(document.querySelector('[data-resource-id="r99"]')).not.toBeNull();
      expect(document.querySelector('[data-resource-id="r0"]')).not.toBeNull();
      expect(screen.getByTestId('allocation-bar')).toBeInTheDocument();
    } finally {
      view.unmount();
      rafSpy.mockRestore();
      delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight;
      useStore.setState({ draggingAllocationId: null });
    }
  });
});

describe('SchedulerGrid', () => {
  it('exposes grid semantics + an sr-only capacity summary for screen readers', () => {
    renderGrid();
    expect(screen.getByRole('grid', { name: 'Resource schedule' })).toBeInTheDocument();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
    expect(screen.getByRole('rowheader', { name: /Bruce/ })).toBeInTheDocument();

    expect(screen.getByText(/1 allocation\./)).toBeInTheDocument();
  });

  it('announces time-off mode, hides work counts and offers keyboard time-off creation', async () => {
    renderGrid();

    act(() => useStore.getState().setDrawMode('timeoff'));

    expect(screen.getByTestId('scheduler-live-region')).toHaveTextContent(/Time-off mode/);
    expect(screen.queryByText(/1 allocation\./)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Add time off for Kord Industries/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add time off for Bruce' }));
    expect(await screen.findByRole('heading', { name: 'Add time off' })).toBeInTheDocument();
  });
});

describe('SchedulerGrid', () => {
  it('folds the per-row utilisation % into the sr-only summary (WCAG 1.3.1)', () => {
    renderGrid();
    // The utilisation % is otherwise only a `title` on a non-interactive span (AT may not expose it);
    // the sr-only summary must carry it, using the "Utilisation" term and the visible-window phrasing.
    expect(screen.getByText(/% utilisation over the visible/)).toBeInTheDocument();
  });

  it('renders saved half days and includes their non-colour signal in the row summary', async () => {
    await useStore.getState().updateResource('r1', { halfDays: [2] });
    renderGrid();

    const row = screen
      .getByRole('rowheader', { name: /Bruce/ })
      .closest('[data-testid="scheduler-row"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByTestId('half-day').length).toBeGreaterThan(0);
    expect(within(row as HTMLElement).getByText(/half working days\./)).toBeInTheDocument();
  });

  it('marks a zero-load block on time off and includes it in the non-colour row summary', async () => {
    await useStore.getState().updateCompany(ACC, { schedulingMode: 'blocks' });
    await useStore.getState().addTimeOff({
      resourceId: 'r1',
      startDate: '2026-06-01',
      endDate: '2026-06-01',
      type: 'holiday',
    });
    useStore.getState().setUtilisationPref({ key: 'showPersonal', value: true });

    renderGrid();

    const row = screen.getByTestId('scheduler-row');
    expect(within(row).getByTestId('over-marker')).toBeInTheDocument();
    expect(within(row).getByText(/Over capacity on 1 day\./)).toBeInTheDocument();
    expect(within(row).getByTestId('utilization')).toHaveTextContent('0%');
    expect(screen.getByTestId('overall-utilization')).toHaveTextContent('0%');
  });
});

describe('SchedulerGrid', () => {
  it('renders each closure once across tracked rows, alongside personal time off, and stops before External', async () => {
    await useStore.getState().updateCompany(ACC, { externalEnabled: true });
    await resetStoreWithData(
      {
        ...useStore.getState().data,
        closures: [
          makeClosure({
            companyId: ACC,
            name: 'Long weekend',
            startDate: '2026-06-05',
            endDate: '2026-06-08',
          }),
        ],
        timeOff: [
          makeTimeOff({
            companyId: ACC,
            resourceId: 'r1',
            startDate: '2026-06-05',
            endDate: '2026-06-08',
          }),
        ],
      },
      ACC,
    );
    useStore.getState().setOriginDate('2026-06-01');
    useStore.getState().setZoom(1);

    renderGrid();

    const band = screen.getByTestId('scheduler-closure-band');
    const rows = screen.getAllByTestId('scheduler-row');
    expect(rows).toHaveLength(2);
    const [firstRow, secondRow] = rows;
    expect(firstRow).toBeDefined();
    expect(secondRow).toBeDefined();
    if (!firstRow || !secondRow) return;
    expect(screen.getAllByTestId('scheduler-closure-band')).toHaveLength(1);
    const labelLayer = screen.getByTestId('scheduler-closure-label-layer');
    expect(labelLayer).toHaveTextContent('Long weekend');
    // Both halves of the closure's stacking, pinned together so neither can regress alone.
    // The band's shading stays under the group-header rows.
    expect(band).toHaveClass('z-0');
    expect(screen.getAllByTestId('discipline-group')[0]).toHaveClass('relative', 'z-10');
    // The name is not inside that `z-0` stacking context, so the rows cannot bury it. It is
    // a sibling in the same context as the rows, lifted above them by the scheduler-local token.
    expect(band.contains(labelLayer)).toBe(false);
    expect(labelLayer.parentElement).toBe(band.parentElement);
    expect(labelLayer.getAttribute('style')).toContain(
      'z-index: var(--z-index-scheduler-closure-label)',
    );

    const labelBox = screen.getByTestId('scheduler-closure-label-box');
    expect(labelBox.style.top).toBe(
      buildVisibleSpanInsets('y', '0px', 'var(--band-height)').leading,
    );
    expect(within(firstRow).getByTestId('timeoff-block')).toBeInTheDocument();
    expect(within(secondRow).queryByTestId('timeoff-block')).not.toBeInTheDocument();
    expect(band.style.height).toBe(
      `${SCHEDULER_DENSITY.groupHeaderHeight + Number.parseInt(firstRow.style.height, 10)}px`,
    );
  });

  // The rendered density reaches both pipelines: the model (row heights, bar offsets) and the view
  // (group headers). Rows use the scaled lane layout while the discipline band keeps its base height.
  it('renders rows at the scaled density while the discipline band stays put', () => {
    renderGrid();
    const [row] = screen.getAllByTestId('scheduler-row');
    const [group] = screen.getAllByTestId('discipline-group');
    if (!row || !group) throw new Error('Expected the scheduler row and discipline group.');
    expect(Number.parseInt(row.style.height, 10)).toBeGreaterThanOrEqual(
      resolveRowHeightForLanes(1, SCHEDULER_LANE_LAYOUT),
    );
    expect(Number.parseInt(row.style.height, 10)).toBeGreaterThan(
      resolveRowHeightForLanes(1, laneLayout),
    );
    expect(group.style.height).toBe(`${LAYOUT.groupHeaderHeight}px`);
  });
});

describe('SchedulerGrid', () => {
  it('does not replay a handled resource jump after a later model change', async () => {
    renderGrid();
    const grid = screen.getByTestId('scheduler-grid');

    act(() => useStore.getState().jumpToResource('r1'));

    expect(grid.scrollTop).toBe(SCHEDULER_DENSITY.groupHeaderHeight);
    expect(useStore.getState().ui.scrollToResource?.consumed).toBe(true);

    await act(async () => {
      grid.scrollTop = 777;
      await useStore.getState().addAllocation({
        resourceId: 'r1',
        activityId: 't1',
        startDate: '2026-06-03',
        endDate: '2026-06-03',
        hoursPerDay: 1,
        status: 'confirmed',
      });
    });

    expect(grid.scrollTop).toBe(777);
  });

  it('expands a collapsed discipline before scrolling to its resource', () => {
    useStore.getState().toggleGroup('d1');
    renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    grid.scrollTop = 444;

    act(() => useStore.getState().jumpToResource('r1'));
    expect(useStore.getState().ui.collapsedGroups).not.toContain('d1');
    expect(grid.scrollTop).toBe(SCHEDULER_DENSITY.groupHeaderHeight);
    expect(useStore.getState().ui.scrollToResource?.consumed).toBe(true);
  });

  it('expands the collapsed External band before scrolling to its resource', async () => {
    await useStore.getState().updateCompany(ACC, { externalEnabled: true });
    useStore.getState().toggleGroup('external');
    renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    grid.scrollTop = 444;

    act(() => useStore.getState().jumpToResource('r-ext'));
    expect(useStore.getState().ui.collapsedGroups).not.toContain('external');
    expect(screen.getByText('Kord Industries')).toBeInTheDocument();
    expect(grid.scrollTop).not.toBe(444);
    expect(useStore.getState().ui.scrollToResource?.consumed).toBe(true);
  });
});

describe('SchedulerGrid visible-window utilisation', () => {
  // The server's figures for a single Mon–Fri resource: eight hours each weekday, booked in full in
  // the first week and not at all after it, so the drawn overall % follows the visible span.
  const span = { from: '2026-06-01', to: '2026-07-26' };
  const capacity = capacityOver(span, {
    'r-diana': {
      byDate: Object.fromEntries(
        eachDayISO(span.from, span.to).map((date, index) => [
          date,
          index % 7 >= 5 ? { available: 0 } : { allocated: date <= '2026-06-05' ? 8 : 0 },
        ]),
      ),
    },
  });

  // Pin origin and focus dates because jsdom leaves the container unmeasured and the visible window otherwise falls back to the current focus date.
  const renderAtZoom = async (zoom: 1 | 8) => {
    await resetStoreWithData(
      schedulerDataset({
        resources: [
          makeResource({
            id: 'r-diana',
            companyId: ACC,
            disciplineId: 'd1',
            name: 'Diana Prince',
            color: '#111',
          }),
        ],
      }),
      ACC,
    );
    useStore.getState().clearFilters();
    getStubPlanningTransport().setCapacity(capacity);
    useStore.setState((st) => ({
      ui: {
        ...st.ui,
        originDate: '2026-06-01',
        focusDate: '2026-06-01',
        zoom,
        collapsedGroups: [],
      },
    }));
    // Moving the grid reads the figures for its new window.
    await useStore.getState().refreshPlanning();
    return renderGrid();
  };
  const overallPct = () =>
    Number.parseInt(screen.getByTestId('overall-utilization').textContent, 10);

  it("the week-range toggle redraws the overall % from the server's figures for the visible span", async () => {
    const v1 = await renderAtZoom(1);
    expect(overallPct()).toBe(100);
    v1.unmount();
    const v8 = await renderAtZoom(8);
    expect(overallPct()).toBe(13);
    v8.unmount();
  });
});

describe('SchedulerGrid company day rollover', () => {
  beforeEach(async () => {
    await resetStoreWithData(dataset(), ACC);
    getStubPlanningTransport().setToday('2026-06-01');
    await useStore.getState().refreshPlanning({ fresh: true });
    useStore.setState((state) => ({
      ui: { ...state.ui, originDate: '2026-06-01', focusDate: '2026-06-01', zoom: 1 },
    }));
  });

  it('moves the today marker and draws the over-soon flag when a read brings them', async () => {
    const view = renderGrid();
    const currentHeader = () =>
      view.container.querySelector('[role="columnheader"] .bg-brand-soft');
    expect(currentHeader()).toHaveTextContent('1');
    const lineBefore = screen.getByTestId('today-line').style.left;
    expect(screen.queryByText(/Overbooked in the next two weeks/)).not.toBeInTheDocument();

    getStubPlanningTransport().setToday('2026-06-02');
    getStubPlanningTransport().setCapacity(
      capacityOver({ from: '2026-06-01', to: '2026-06-07' }, { r1: { overSoon: true } }),
    );
    await act(() => useStore.getState().refreshPlanning({ fresh: true }));

    expect(currentHeader()).toHaveTextContent('2');
    expect(screen.getByTestId('today-line').style.left).not.toBe(lineBefore);
    expect(screen.getByText(/Overbooked in the next two weeks/)).toBeInTheDocument();
  });
});

describe('SchedulerGrid filters', () => {
  it('shows an empty state when the search matches nobody', () => {
    useStore.getState().setFilters({ search: 'no-such-person' });
    renderGrid();
    const emptyRow = screen.getByTestId('scheduler-empty');
    const grid = screen.getByRole('grid', { name: 'Resource schedule' });
    expect(emptyRow).toBeInTheDocument();
    expect(emptyRow).toHaveAttribute('aria-rowindex', '2');
    expect(grid).toHaveAttribute('aria-rowcount', String(screen.getAllByRole('row').length));
  });
});

// Scroll-snap integration needs measured viewport dimensions, synchronous animation frames, and fake idle timers because jsdom does not lay out the grid. Read actual fitted offsets so remainder pixels stay owned by geometry.
let schedulerRafSpy: { mockRestore(): void };

function installSchedulerSnapHooks() {
  beforeEach(() => {
    vi.useFakeTimers();

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 600,
    });
    // Run the onScroll rAF synchronously so its body executes within the dispatched scroll event; the
    // setTimeout(WEEK_SNAP_IDLE_MS) it arms is still driven by the fake timers below.
    schedulerRafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    useStore.getState().setMinimiseWeekends(false);

    useStore.setState((st) => ({
      ui: {
        ...st.ui,
        originDate: '2026-06-01',
        focusDate: '2026-06-01',
        zoom: 1,
        collapsedGroups: [],
      },
    }));
  });

  afterEach(() => {
    schedulerRafSpy.mockRestore();
    vi.useRealTimers();
    delete (HTMLElement.prototype as unknown as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as unknown as { clientHeight?: number }).clientHeight;
    // Restore the default so later tests start with week snap enabled.
    useStore.setState({ weekSnapEnabled: true });
    useStore.getState().setMinimiseWeekends(true);
    useStore.setState({ draggingAllocationId: null });
  });
}

describe('SchedulerGrid — week snap (Feature 2 wiring)', () => {
  installSchedulerSnapHooks();

  it('snap on: a mid-week nudge floors back to the week start after the idle (and not before)', () => {
    useStore.setState({ weekSnapEnabled: true });
    const view = renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    const { nudge, snapped } = fittedSchedulerGridOffsets();

    scrollSchedulerGridTo(nudge);

    expect(grid.scrollLeft).toBe(nudge);
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(grid.scrollLeft).toBe(nudge);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(grid.scrollLeft).toBe(snapped);
    view.unmount();
  });
});

describe('SchedulerGrid — week snap (Feature 2 wiring)', () => {
  installSchedulerSnapHooks();

  it('re-arms on each scroll: two quick scrolls fire only ONE snap, after the final idle', () => {
    useStore.setState({ weekSnapEnabled: true });
    const view = renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    const { nudge, snapped, week } = fittedSchedulerGridOffsets();

    scrollSchedulerGridTo(nudge);
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(grid.scrollLeft).toBe(nudge);

    scrollSchedulerGridTo(nudge + week);
    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(grid.scrollLeft).toBe(nudge + week);

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(grid.scrollLeft).toBe(snapped + week);
    view.unmount();
  });

  it('test override off: a nudge is left where it lands (no snap timer armed)', () => {
    useStore.setState({ weekSnapEnabled: false });
    const view = renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    const { nudge } = fittedSchedulerGridOffsets();

    scrollSchedulerGridTo(nudge);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(grid.scrollLeft).toBe(nudge);
    view.unmount();
  });

  it('does not arm a horizontal snap for a purely vertical scroll', () => {
    useStore.setState({ weekSnapEnabled: false });
    const view = renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    const { nudge } = fittedSchedulerGridOffsets();

    // A vertical-only scroll must not restart horizontal snapping at an existing mid-week offset.
    scrollSchedulerGridTo(nudge);
    act(() => useStore.setState({ weekSnapEnabled: true }));
    act(() => {
      grid.scrollTop = 400;
      grid.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(500);
    });

    expect(grid.scrollTop).toBe(400);
    expect(grid.scrollLeft).toBe(nudge);
    view.unmount();
  });
});

describe('SchedulerGrid — week snap (Feature 2 wiring)', () => {
  installSchedulerSnapHooks();

  it('drag-freeze: a snap armed before a drag bails when it fires mid-drag', () => {
    useStore.setState({ weekSnapEnabled: true });
    const view = renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    const { nudge } = fittedSchedulerGridOffsets();

    scrollSchedulerGridTo(nudge);

    act(() => useStore.setState({ draggingAllocationId: 'x' }));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(grid.scrollLeft).toBe(nudge);
    view.unmount();
  });

  it('convergence: a scroll that lands exactly on a week start writes nothing back', () => {
    useStore.setState({ weekSnapEnabled: true });
    const view = renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    const { week } = fittedSchedulerGridOffsets();

    scrollSchedulerGridTo(week);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(grid.scrollLeft).toBe(week);
    view.unmount();
  });

  it('clears the pending snap timer on unmount (no late write to a detached node)', () => {
    useStore.setState({ weekSnapEnabled: true });
    const view = renderGrid();
    const grid = screen.getByTestId('scheduler-grid');
    const { nudge } = fittedSchedulerGridOffsets();

    scrollSchedulerGridTo(nudge);

    view.unmount();

    expect(() =>
      act(() => {
        vi.advanceTimersByTime(500);
      }),
    ).not.toThrow();
    expect(grid.scrollLeft).toBe(nudge);
  });
});
