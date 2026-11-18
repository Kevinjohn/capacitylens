import { afterAll, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

// Radix focus scope dispatches its unmount event from a zero-delay timer. The shared cleanup must let
// that timer run while this file's environment still exists; afterwards jsdom rejects the event.
const dispatchEvent = vi.spyOn(EventTarget.prototype, 'dispatchEvent');
const unmountEvents = () =>
  dispatchEvent.mock.calls.filter(([event]) => event.type === 'focusScope.autoFocusOnUnmount');

it('mounts a dialog that the shared cleanup unmounts', () => {
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Oracle</DialogTitle>
        <DialogDescription>Barbara Gordon's console</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
  expect(unmountEvents()).toHaveLength(0);
});

afterAll(() => {
  const dispatched = unmountEvents().length;
  dispatchEvent.mockRestore();
  expect(dispatched).toBe(1);
});
