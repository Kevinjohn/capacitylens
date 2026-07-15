# 08 — Responsive, mobile and accessibility

CapacityLens is not a mobile scheduling application. It still behaves respectfully on small
screens. That distinction—honest scope without neglect—is the family pattern.

## State the mobile product boundary

Ask whether the primary workflow can remain coherent on a phone:

- Is the information inherently wide or dense?
- Does touch remove precision required by the interaction?
- Would a phone view become a different product rather than a responsive layout?
- Is mobile access mostly for reading, triage or a small subset of actions?

CapacityLens answers: weekly scheduling is desktop/landscape work; portrait phone scheduling is a
non-goal. It does not pretend an eight-week grid becomes usable through tiny cells.

Each sibling should choose one:

1. mobile-first/full workflow;
2. responsive but desktop-optimised;
3. mobile read-only/limited workflow;
4. unsupported with a clear explanation.

Record it publicly.

## CapacityLens small-screen posture

- Sidebar defaults collapsed when width ≤767px or height ≤480px.
- The collapsed rail's icons expand the menu rather than navigate.
- Portrait phones ≤767px see a dismissible “Best in landscape” dialog.
- The hint appears over first-contact surfaces including sign-in/picker.
- Rotation to landscape hides it.
- Dismissal lasts only for the browser session.
- The underlying heading remains available to assistive technology.
- Scheduler continues to support horizontal scrolling and touch gestures where practical.

This is a nudge, not a hard device block.

## Mobile rules siblings inherit

- Never serve a blank “desktop only” page if a useful read/administrative subset can render.
- Do not use hover as the only explanation.
- Use at least comfortable touch targets; do not shrink a dense desktop control below usability.
- Avoid accidental destructive navigation in narrow rails.
- Test portrait and landscape.
- Do not persist orientation hints as account data.
- Respect safe areas if installing as a web app.
- Keep auth, invite, reset and incident/recovery surfaces usable on small screens even when the main
  workflow is desktop-first.

## Accessibility baseline

WCAG is a release gate, not a later audit.

### Structure

- One meaningful `main` landmark per shell.
- Navigation uses `nav` and lists.
- Skip link targets the main landmark.
- Headings form a sensible hierarchy.
- Each SPA route updates `document.title`.
- Empty/loading/error states use appropriate landmarks/status.

### Names and descriptions

- Visible labels name form controls.
- Icon-only controls have contextual `aria-label`.
- Decorative icons use `aria-hidden`.
- Required markers are decorative; `aria-required` carries semantics.
- Invalid controls use `aria-invalid` and `aria-describedby` pointing to the visible message.
- Disabled destructive controls may point to the prerequisite explanation.
- Swatches use human names, not hex codes alone.

### Keyboard

- Entire primary workflow is keyboard reachable.
- Focus order follows visual/task order.
- Modals and command palettes contain Tab and restore invoking focus.
- Escape has predictable ownership.
- Global shortcuts do not steal text-editing shortcuts.
- Drag-only interactions receive keyboard equivalents where the operation is essential.
- Focus rings remain visible against light, dark and user-coloured surfaces.

### Dynamic feedback

- Loading and offline state use `role="status"`.
- Data/persistence failures use `role="alert"` where immediate announcement is appropriate.
- Persistent notices have a close button.
- Timed informational toasts are not the only place critical information exists.
- A successful but truncated/clamped action is a persistent warning, not a disappearing success.

### Modals and overlays

- Dialog has an accessible title.
- Portal out of restrictive ARIA containers such as grid.
- Background is inert for a true modal command surface.
- If a light-touch non-modal implementation keeps background content readable for a specific
  reason, document and test that choice.
- Backdrop and Escape respect dirty-form protection.

### Motion and visual

- Respect `prefers-reduced-motion` globally.
- Colour never carries the only state signal.
- Small text meets 4.5:1.
- Non-text focus and boundaries meet their required contrast.
- Do not use inaccessible library “rich colour” defaults unexamined.
- Test both themes because a token that passes in light may fail in dark.

## Scheduler/dense-canvas lessons

For any dense grid, timeline, map or canvas:

- provide a real semantic DOM structure where possible;
- keep row summaries for signals not reachable by pointer;
- make resize/move operations keyboard accessible;
- announce meaningful changes;
- keep overlay dialogs portalled out of grid ownership;
- use pointer-independent labels/popovers;
- cancel gestures with Escape;
- avoid test hooks as production styling/state selectors;
- virtualise only after preserving semantic and focus behaviour.

CapacityLens's over-capacity cell has no unreachable tooltip; the row header carries a screen-reader
summary instead.

## Test strategy

Automate:

- axe scans on primary routes and open dialogs;
- keyboard-only critical flows;
- focus restoration;
- role/name queries rather than brittle CSS selectors;
- portrait rotation hint and collapsed navigation;
- reduced-motion CSS presence;
- colour contrast helpers;
- no critical axe violations in light and dark.

Manually check:

- VoiceOver/NVDA/other target screen reader on the primary path;
- browser zoom and text enlargement;
- touch on iOS Safari and Android Chrome if claimed;
- high-contrast/forced-colour behaviour where relevant;
- long translated labels;
- landscape phone height, not only portrait width.

## Mobile decision worksheet

For a new sibling, document:

- primary mobile jobs;
- explicitly unavailable mobile jobs;
- minimum supported viewport;
- navigation transformation;
- touch alternative for pointer gestures;
- whether offline reading matters more on mobile;
- whether notifications/camera/location are truly core;
- what is responsive CSS versus a separate product flow;
- which devices/browsers are in the release matrix.
