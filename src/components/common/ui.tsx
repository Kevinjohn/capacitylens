/* eslint-disable react-refresh/only-export-components --
 * Barrel file: it re-exports only (no local component definitions), so it is not itself a
 * Fast Refresh boundary — the rule's `export *` check is a false positive here. Fast
 * Refresh still works at the component-defining modules (./dialogs, ./fields, etc.). */
// Shared presentational kit — a barrel that re-exports the grouped slices so the whole
// app keeps importing from '../common/ui'. The implementations live in sibling modules,
// split only to keep each file editable; the public surface here is unchanged. Colours
// come from semantic tokens (see index.css), so everything adapts to dark mode.
//
//   ./dialogs   Button, Modal, ConfirmDialog, ListPage, EmptyState
//   ./fields    TextField, TextAreaField, NumberField, DateField, SelectField, Option,
//               ColorField, WeekdayPicker, RequiredLegend
//   ./feedback  Callout, FieldError  (transient toasts moved to Sonner — see AppShell)
//   ./badges    TemporaryTag, ColorSwatch, PLACEHOLDER_AVATAR_SYMBOL, Avatar

export * from './dialogs'
export * from './fields'
export * from './feedback'
export * from './badges'
