# 07 — Design system

Siblings should copy the semantic design language, not sprinkle matching hex values across new
components. CapacityLens uses Tailwind CSS v4 tokens backed by CSS variables and a separate,
contained shadcn token layer.

## Semantic colour roles

| Token | Meaning | Typical utility |
| --- | --- | --- |
| `canvas` | Page/app background | `bg-canvas` |
| `surface` | Panels, cards, controls | `bg-surface` |
| `elevated` | Popovers, tooltips, toasts | `bg-elevated` |
| `line` | Normal border/divider | `border-line` |
| `line-soft` | Quiet structural divider | `border-line-soft` |
| `line-faint` | Fine grid/day hairline | `border-line-faint` |
| `weekend` | Recessed/non-working band | `bg-weekend` |
| `ink` | Primary text | `text-ink` |
| `muted` | Secondary text | `text-muted` |
| `faint` | Tertiary/placeholder text | `text-faint` |
| `brand` | Product identity, navigation, selection, focus | `text-brand` / `bg-brand` |
| `brand-strong` | Stronger brand surface | `bg-brand-strong` |
| `brand-soft` | Selected/quiet brand surface | `bg-brand-soft` |
| `brand-soft-ink` | Text on soft brand surface | `text-brand-soft-ink` |
| `ok` | Positive status | `text-ok` |
| `ok-strong` | Positive create/save/add/continue action | `bg-ok-strong` |
| `ok-strong-ink` | Text on positive action | `text-ok-strong-ink` |
| `warn` | Warning/attention | `text-warn` / `border-warn` |
| `danger` | Error/destructive identity | `text-danger` |
| `danger-soft` | Destructive button surface | `bg-danger-soft` |
| `danger-soft-ink` | Text on destructive surface | `text-danger-soft-ink` |
| `danger-cell` | Strong empty visual alert cell | `bg-danger-cell` |

Never use `text-blue-600`, `bg-red-50` or an inline hex for product chrome. Entity/data swatches are
the exception because the colour is user/domain data.

## Exact family palette

### Light

| Role | Value |
| --- | --- |
| base/canvas | `#f4f5f8` |
| surface/elevated | `#ffffff` |
| line | `#e6e8ee` |
| line soft | `#eef0f5` |
| line faint | `#ebedf2` |
| ink | `#1c2230` |
| muted | `#5b6472` |
| faint | `#677080` |
| brand | `#2563eb` |
| brand strong | `#1d4ed8` |
| brand soft | 14% brand mixed with white |
| brand soft ink | brand strong |
| danger | `#e11d48` |
| danger soft | 13% danger mixed with white |
| danger soft ink | `#be123c` |
| danger cell | 50% danger mixed with white |
| warning | `#d97706` |
| positive | `#047857` |
| positive strong | `#047857` |
| positive strong hover | `#065f46` |
| positive strong ink | `#ffffff` |

### Dark

| Role | Value |
| --- | --- |
| base/canvas | `#0e1016` |
| surface | `#161922` |
| elevated | `#1d212c` |
| line / line soft | `#2a2f3c` |
| line faint | `#20242f` |
| ink | `#e7eaf0` |
| muted | `#a3acbd` |
| faint | `#8b93a3` |
| brand | `#60a5fa` |
| brand strong | `#2563eb` |
| brand soft | 22% brand mixed with `#0e1016` |
| brand soft ink | `#bfdbfe` |
| danger | `#fb7185` |
| danger soft | 22% danger mixed with `#0e1016` |
| danger soft ink | `#fda4af` |
| danger cell | 60% danger mixed with `#0e1016` |
| warning | `#fbbf24` |
| positive | `#34d399` |
| positive strong | `#047857` |
| positive strong hover | `#065f46` |
| positive strong ink | `#ffffff` |

Weekend/non-working tint is derived by mixing ink into surface (8% light, 7% dark). It is
deliberately cool and distinct from warning/danger.

CapacityLens owns the live authoritative theme in [`src/index.css`](../src/index.css). A copy-ready
snapshot lives in [`reference-kit/packages/tokens/theme.css`](reference-kit/packages/tokens/theme.css)
for deliberate sibling adoption. Compare it with the live file before copying; the snapshot is not
imported by CapacityLens.

## Semantic action language

- **Blue**: product wordmark, active navigation, selection, links, focus, identity.
- **Green**: Add, Create, Save, Continue and other positive commits.
- **Red**: delete, permanent destruction and error.
- **Amber**: warning and domain attention states.
- **User swatches**: identity of client/project/category, never action semantics.
- **Neutral grey**: external/awareness identity and safe fallback.

This separation is a family invariant. A “primary” button is not automatically brand blue.

## Theme mechanism

- User preference is `light | dark | system`.
- JavaScript resolves system and sets `data-theme="light|dark"` on `<html>`.
- Components use semantic utilities and normally need no per-component `dark:` classes.
- A Tailwind custom dark variant points shadcn's dark utilities at the data attribute.
- An early static theme initialiser prevents flash before React loads.
- `color-scheme` tracks the resolved theme.
- Theme is device-global, not account data.

## Tailwind/shadcn boundary

CapacityLens keeps two token layers:

1. Product semantic `--c-*` tokens used by product components.
2. Stock shadcn variables used only by generated/adapted primitives in `src/components/ui/`.

Important collision rules:

- Do not regenerate `src/index.css` with `shadcn init`.
- Add individual components with `shadcn add`.
- Product `--color-muted` means muted text; shadcn `--muted` means a surface. Do not map one over
  the other.
- Product radius utilities remain owned by the product theme.
- Adapt primitive colours through the product component kit rather than letting stock slate
  semantics leak into screens.

## User-selectable swatches

CapacityLens supplies a fixed 52-colour palette: thirteen hue columns by four shade rows. Siblings
should reuse it where users assign identity colours.

Rules:

- persisted user colours must be in the preset set;
- no free-form colour input;
- each swatch has a localised human-readable accessible name such as “Blue bright”;
- default new accounts/resources use `#2d75da`;
- neutral `#9ca3af` is a system exception, not user-selectable;
- derive a readable text colour from WCAG luminance;
- nudge bar backgrounds until their label pairing reaches normal-text AA;
- test contrast and palette inclusion.

The exact live array and contrast helpers belong to CapacityLens's
[colour module](../shared/src/lib/color.ts). A reusable snapshot lives in
[`reference-kit/packages/tokens/src/colors.ts`](reference-kit/packages/tokens/src/colors.ts).

## Typography and shape

Family defaults:

- system font stack: system UI, Apple system, Segoe UI, Roboto, Helvetica, Arial;
- body/controls: `text-sm`;
- supporting copy: `text-xs`;
- dense micro-label only: semantic `text-2xs` at 11px/16px;
- heading weights use semibold/bold, not decorative fonts;
- headings use balanced wrapping;
- normal radius `0.5rem`, large/card radius `0.75rem`;
- elevated pop shadow: `0 10px 30px -10px rgb(0 0 0 / 0.3)`, stronger in dark;
- compact controls with consistent shared base spacing.

Avoid arbitrary `text-[10px]`, colour or radius values. Add a semantic token when a genuinely new
role exists.

## Component ownership

Use two layers:

- `components/ui/`: low-level generated/adapted primitives (button, tooltip, popover, command,
  input, textarea).
- `components/common/`: product API and visual semantics (Button, Add/Edit/Delete buttons, Modal,
  fields, feedback, badges, focus helpers, list/empty layouts).

Feature components import the product kit, not a mixture of raw primitive variants and repeated
class strings.

### Buttons

- Positive action: green solid.
- Ghost/secondary: surface + border + ink.
- Destructive: soft red surface with AA-safe red ink.
- Add buttons include a decorative plus and visible label.
- Row edit/delete/archive may be icon-only but require contextual accessible name and tooltip/title.
- Dialog commit/destructive buttons keep visible text.
- Disabled controls explain prerequisites when useful via `aria-describedby`.

### Forms

- Shared control base for text, number, date, select and toolbar controls.
- Visible label; required asterisk is decorative.
- `aria-required`, `aria-invalid` and associated error id.
- Browser caps backstop shared validation.
- Preset colour field uses a named grid.
- Switch uses `role="switch"` and `aria-checked`.
- Segmented control uses proper radio semantics.
- First intended field is marked for modal autofocus.

### Dialogs

- Render through a portal so they do not become invalid children of a grid.
- Provide name/title, backdrop, Escape, contained Tab and focus restoration.
- Guard accidental dismissal of dirty forms.
- Explicit Cancel/Save owns intentional closure.
- Confirmation-only dialogs can disable dirty guarding.
- Destructive dialogs name the object and downstream consequence.

### Feedback

- Persistent error/warning notices have a visible close control.
- Error has red accent plus icon/text; colour is not the sole signal.
- Keep text on the already-tested elevated/ink pairing.
- Loading states use `role="status"`.
- Blocking corruption/unavailability uses a recovery screen rather than an empty editable dataset.

## Copy and language

Family user-facing English is UK English:

- Colour, Utilisation, Minimise, Authorised where appropriate.

Code follows ecosystem conventions:

- `color` in CSS/data fields;
- `authorize` where matching an API/library convention;
- `accountId` in the domain even when UI says company.

Do not mechanically change code identifiers to UK spellings if it fights web/platform vocabulary.
Do not leak American code spellings into visible labels.

Copy rules:

- sentence case;
- concrete nouns;
- errors say what happened and how to recover;
- avoid generic “Something went wrong” when a safe reason exists;
- warnings distinguish success-with-side-effect from failure;
- do not promise a control that is hidden;
- keep destructive language precise: Archive, Delete, Delete permanently;
- never call a capacity signal “Load” in CapacityLens; each sibling picks and enforces its own
  canonical terms.

## i18n seam

- Source messages live outside components.
- Type-safe generated message functions make deleted keys a compile error.
- Module-scope definitions store label getters, not resolved strings.
- Resolve copy at render/call time.
- Account language may select locale without page reload.
- Use message templates for word order, including colour names.
- Generated files are ignored and never hand-edited.

Even an English-only first release benefits: copy is centralised, testable and ready for another
locale without rewriting navigation.

## Visual acceptance checklist

- Light and dark screenshots checked.
- Small text/background pairs meet 4.5:1.
- Non-text focus/controls meet 3:1 where required.
- Focus is visible on every interactive element.
- No meaning relies only on hue.
- Positive, brand and destructive roles remain visually distinct.
- Long labels and localisation do not break layout.
- Reduced motion disables non-essential animation.
- User swatches choose readable label ink.
- Toasts, tooltips and tour popovers use product tokens.
