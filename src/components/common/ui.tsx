/* eslint-disable react-refresh/only-export-components --
 * Barrel file: it re-exports only (no local component definitions), so it is not itself a
 * Fast Refresh boundary — the rule's `export *` check is a false positive here. Fast
 * Refresh still works at the component-defining modules (./dialogs, ./fields, etc.). */
// Product-level UI compositions. Generic primitives live in ../ui; this barrel exposes the
// CapacityLens-specific behaviors layered on top of them.
//
//   ./dialogs           AddButton, EditButton, DeleteButton, Modal, ConfirmDialog,
//                       ListPage, EmptyState
//   ./fields            TextField, TextAreaField, NumberField, DateField, SelectField, Option,
//                       ColorField, WeekdayPicker, RequiredLegend
//   ./badges            ColorSwatch, PLACEHOLDER_AVATAR_SYMBOL, Avatar
//   ./SegmentedControl  SegmentedControl, SegmentedOption  (the pill radio-group chooser)

export * from './dialogs'
export * from './fields'
export * from './badges'
export * from './SegmentedControl'
