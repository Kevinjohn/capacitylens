/* eslint-disable react-refresh/only-export-components --
 * Barrel file: it re-exports only (no local component definitions), so it is not itself a
 * Fast Refresh boundary. The rule's `export *` check is a false positive here. Fast
 * Refresh still works at the component-defining modules (./dialogs, ./fields, etc.). */
// Product compositions layer CapacityLens behaviour over the generic primitives.

export * from "./dialogs";
export * from "./ListPage";
export * from "./fields";
export * from "./badges";
export * from "./SegmentedControl";
export * from "./TogglePill";
export * from "./SectionHelp";
export * from "./FormActions";
