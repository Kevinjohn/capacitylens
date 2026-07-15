# [Product] — User-story reference

This file pins exact routes, labels, test ids, seed facts and shared conventions. Update it first
when visible behaviour changes.

## Launching the app

1. Command and URL.
2. Demo versus server persistence.
3. Sign-in/first-owner flow.
4. Tenant picker/create choices.
5. Product intro.
6. Getting-started checklist/tour.
7. Reset/seed instructions.

## Navigation

| Label | Route | Screen | Feature/role condition |
| --- | --- | --- | --- |
|  |  |  |  |

Document collapse/mobile behaviour, data actions and company/footer controls.

## Seed data

Use fictional data. Record dates, ids only when tests depend on them, built-in records and feature
flags.

## Control labels

Record:

- form field labels;
- add/edit/archive/delete names;
- toolbar controls;
- filter controls;
- Settings switches;
- confirmation titles/actions;
- empty/error/read-only text that tests use.

## Authentication and permissions

- auth modes;
- first owner;
- invites;
- member management;
- password reset;
- Viewer behaviour;
- field-level privacy.

## Command palette

Open/close shortcut, sections, structured queries, selection effects and keyboard behaviour.

## Stable test hooks

List only hooks that cannot be selected reliably by role/name, and state when each exists.

## Domain rules

Document:

- required relationships;
- discriminated kinds;
- built-in records;
- optional feature projections;
- lifecycle/cascades;
- calculations/equality/windows;
- validation and preset values;
- privacy projection.

## Story conventions

- Defined starting state.
- Checkable acceptance criteria.
- Stable ids for cross-cutting security criteria.
- Linked automated test names/files.
