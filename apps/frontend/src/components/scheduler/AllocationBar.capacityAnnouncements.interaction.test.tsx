import { requireCreated } from '@/test/requireCreated';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { AllocationBar } from './AllocationBar';
import { useStore } from '@/store/useStore';
import { resetStoreWithAccount, makeResourceDraft } from '@/test/fixtures';
import { renderWithOwnerAndTooltip as render, GEOM, indexAtClientX } from '@/test/schedulerTestKit';
import { getStubPlanningTransport } from '@/test/planningTransportHandle';
import { capacityOver } from '@/test/capacityFixtures';

import {
  barFor,
  getSrAnnouncement,
  getStoredAllocation,
  seedAllocation,
  seedVisibleAllocationWithHiddenCapacity,
  settlePlanning,
} from '@/test/allocationBarInteractionTestKit';

beforeEach(async () => resetStoreWithAccount());

async function seedConflictPair() {
  const st = useStore.getState();
  const c = await requireCreated(st.addClient({ name: 'Ferris', color: '#1' }));
  const p = await requireCreated(st.addProject({ name: 'P', clientId: c.id, color: '#2' }));
  const t = await requireCreated(
    st.addActivity({ name: 'Wires', kind: 'project', projectId: p.id }),
  );
  const r = await requireCreated(
    st.addResource(makeResourceDraft({ name: 'Ty', role: 'Dev', color: '#3' })),
  );
  await st.addAllocation({
    resourceId: r.id,
    activityId: t.id,
    startDate: '2026-06-03',
    endDate: '2026-06-03',
    hoursPerDay: 8,
    status: 'confirmed',
  });
  return requireCreated(
    await st.addAllocation({
      resourceId: r.id,
      activityId: t.id,
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      hoursPerDay: 8,
      status: 'confirmed',
    }),
  );
}

describe('AllocationBar capacity announcement interactions', () => {
  describe('keyboard edit announces the server capacity after the reply (a11y live region)', () => {
    // The announcement reads the figures of the canonical read that follows the write. Each case
    // sets the stub's figures after seeding, so only that read carries them.
    it('announces the over-capacity outcome from the reply, and "no conflicts" when the next reply resolves it', async () => {
      // Anchor the visible window to the fixed fixture dates so capacity announcements remain deterministic as today advances.
      useStore.setState((s) => ({ ui: { ...s.ui, originDate: '2026-06-01', rangeDays: 14 } }));
      const b = await seedConflictPair();
      await settlePlanning();
      const transport = getStubPlanningTransport();
      const window = { from: '2026-06-01', to: '2026-06-14' };
      transport.setCapacity(
        capacityOver(window, {
          [b.resourceId]: { byDate: { '2026-06-03': { allocated: 16, over: true } } },
        }),
      );
      const { rerender } = render(
        <AllocationBar
          bar={barFor(b)}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />,
      );
      expect(useStore.getState().srAnnouncement).toBeNull();
      // Before the write the store holds the figures of an earlier read, with no over day.
      expect(useStore.getState().planning.capacity?.resources[b.resourceId]).toBeUndefined();

      fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight' });
      await settlePlanning();
      let moved = getStoredAllocation(b.id);
      expect([moved.startDate, moved.endDate]).toEqual(['2026-06-02', '2026-06-03']);
      const over = getSrAnnouncement();
      expect(over.text).toBe('Ty now over capacity on 1 day.');

      transport.setCapacity(capacityOver(window, { [b.resourceId]: {} }));
      rerender(
        <AllocationBar
          bar={barFor(moved)}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />,
      );
      fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowLeft' });
      await settlePlanning();
      moved = getStoredAllocation(b.id);
      expect([moved.startDate, moved.endDate]).toEqual(['2026-06-01', '2026-06-02']);
      const clear = getSrAnnouncement();
      expect(clear.text).toBe('Ty: no capacity conflicts.');
      expect(clear.seq).toBeGreaterThan(over.seq);
    });

    // Gesture announcements count only conflicts within the visible zoom window; off-window conflicts must not enter the spoken result.
    it('does NOT count an over-day OUTSIDE the visible window (spoken count == rendered row summary)', async () => {
      useStore.setState((s) => ({ ui: { ...s.ui, originDate: '2026-06-01', rangeDays: 14 } }));
      const b = await seedConflictPair();
      await settlePlanning();
      // The figures reach past the visible window, with the one over day beyond it.
      getStubPlanningTransport().setCapacity(
        capacityOver(
          { from: '2026-06-01', to: '2026-09-28' },
          { [b.resourceId]: { byDate: { '2026-09-02': { allocated: 16, over: true } } } },
        ),
      );
      const { rerender } = render(
        <AllocationBar
          bar={barFor(b)}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />,
      );
      fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowRight' });
      await settlePlanning();
      expect(getSrAnnouncement().text).toBe('Ty: no capacity conflicts.');

      // A wider window must include the same conflict, proving the announcement is scoped by visibility.
      useStore.setState((s) => ({ ui: { ...s.ui, originDate: '2026-06-01', rangeDays: 120 } }));
      rerender(
        <AllocationBar
          bar={barFor(getStoredAllocation(b.id))}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />,
      );
      fireEvent.keyDown(screen.getByTestId('allocation-bar'), { key: 'ArrowLeft' });
      await settlePlanning();
      expect(getSrAnnouncement().text).toBe('Ty now over capacity on 1 day.');
    });
    it('does NOT announce on a pointer drag (sighted feedback — would be noise)', async () => {
      const a = await seedAllocation();
      render(
        <AllocationBar
          bar={barFor(a)}
          geom={GEOM}
          indexAtClientX={indexAtClientX}
          onEdit={vi.fn()}
        />,
      );
      const bar = screen.getByTestId('allocation-bar');

      fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
      document.dispatchEvent(new MouseEvent('pointermove', { clientX: 98, bubbles: true }));
      document.dispatchEvent(new MouseEvent('pointerup', { clientX: 98, bubbles: true }));
      await settlePlanning();

      expect(getStoredAllocation(a.id).startDate).toBe('2026-06-02');
      expect(useStore.getState().srAnnouncement).toBeNull();
    });
  });
  it('excludes retained hidden allocations from pointer capacity advice', async () => {
    const visible = await seedVisibleAllocationWithHiddenCapacity();
    // Adopt the helper's direct archive fixture before sending an allocation edit.
    await useStore.getState().refreshPlanning();
    render(
      <AllocationBar
        bar={barFor(visible)}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId('allocation-bar'), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 98, bubbles: true }));
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 98, bubbles: true }));
    await settlePlanning();

    expect(getStoredAllocation(visible.id)).toMatchObject({
      startDate: '2026-06-02',
      endDate: '2026-06-03',
    });
    expect(useStore.getState().notice?.message ?? '').not.toMatch(/over capacity/i);
  });

  it('pins the dragged row (draggingAllocationId) on the first move and clears it on commit', async () => {
    const a = await seedAllocation();
    render(
      <AllocationBar
        bar={barFor(a)}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    const bar = screen.getByTestId('allocation-bar');
    expect(useStore.getState().draggingAllocationId).toBeNull();

    fireEvent.pointerDown(bar, { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 98, bubbles: true }));
    expect(useStore.getState().draggingAllocationId).toBe(a.id);

    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 98, bubbles: true }));
    await settlePlanning();
    expect(useStore.getState().draggingAllocationId).toBeNull();
  });

  it('clears the drag-pin on pointercancel, and on unmount if the bar still owns it', async () => {
    const a = await seedAllocation();
    const { unmount } = render(
      <AllocationBar
        bar={barFor(a)}
        geom={GEOM}
        indexAtClientX={indexAtClientX}
        onEdit={vi.fn()}
      />,
    );
    fireEvent.pointerDown(screen.getByTestId('allocation-bar'), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, bubbles: true }));
    expect(useStore.getState().draggingAllocationId).toBe(a.id);
    document.dispatchEvent(new Event('pointercancel'));
    expect(useStore.getState().draggingAllocationId).toBeNull();

    fireEvent.pointerDown(screen.getByTestId('allocation-bar'), { clientX: 50, button: 0 });
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, bubbles: true }));
    expect(useStore.getState().draggingAllocationId).toBe(a.id);
    unmount();
    expect(useStore.getState().draggingAllocationId).toBeNull();
  });
});
