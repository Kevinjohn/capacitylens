import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import {
  Modal,
  ConfirmDialog,
  ListPage,
  EmptyState,
  TextField,
  TextAreaField,
  NumberField,
  DateField,
  SelectField,
  ColorField,
  WeekdayPicker,
  ColorSwatch,
  Avatar,
  SegmentedControl,
} from "./ui";
import { Button } from "../ui/button";
import { EmptyDescription } from "../ui/empty";
import { Alert, AlertDescription } from "../ui/alert";
import { FieldError } from "../ui/field";
import { Switch } from "../ui/switch";
import { useStore } from "../../store/useStore";
import { colorName, SWATCHES } from "../../lib/palette";
import { emptyAppData } from "@capacitylens/shared/types/entities";

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

// ─── Button ────────────────────────────────────────────────────────────────

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders primary variant by default", () => {
    render(<Button>Primary</Button>);
    // Primary has a specific class; just verify it renders without crashing and text is there
    const button = screen.getByRole("button", { name: "Primary" });
    expect(button).toBeInTheDocument();
    // Opacity must switch immediately when disabled clears. Transitioning every property briefly
    // creates an enabled, semi-transparent button whose text fails WCAG contrast after a request.
    expect(button).toHaveClass("transition-colors");
    expect(button).not.toHaveClass("transition-all");
  });

  it("renders ghost variant", () => {
    render(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole("button", { name: "Ghost" })).toBeInTheDocument();
  });

  it("renders danger variant", () => {
    render(
      <>
        <Button>Primary</Button>
        <Button variant="danger-soft">Danger</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Primary" })).toHaveClass("bg-ok-strong", "text-ok-strong-ink");
    expect(screen.getByRole("button", { name: "Danger" })).toHaveClass("bg-danger-soft", "text-danger-soft-ink");
  });
});

describe("Alert", () => {
  it("keeps destructive body copy on the opaque danger token", () => {
    render(
      <Alert variant="destructive">
        <AlertDescription>Save failed.</AlertDescription>
      </Alert>,
    );

    expect(screen.getByRole("alert")).toHaveClass("*:data-[slot=alert-description]:text-destructive");
    expect(screen.getByRole("alert")).not.toHaveClass("*:data-[slot=alert-description]:text-destructive/90");
  });
});

describe("Switch", () => {
  it("uses the semantic non-text-contrast tokens instead of theme-specific overrides", () => {
    render(<Switch aria-label="Availability" />);

    const control = screen.getByRole("switch", { name: "Availability" });
    expect(control).toHaveClass("data-[state=unchecked]:bg-switch-track");
    expect(control).not.toHaveClass("data-[state=unchecked]:bg-input");
    expect(control.firstElementChild).toHaveClass("bg-switch-thumb");
  });

  it("preserves the deliberate default and small track/thumb geometry", () => {
    render(
      <>
        <Switch aria-label="Default size" />
        <Switch aria-label="Small size" size="sm" />
      </>,
    );

    const defaultSwitch = screen.getByRole("switch", { name: "Default size" });
    expect(defaultSwitch).toHaveClass(
      "data-[size=default]:h-6",
      "data-[size=default]:w-10",
      "data-[size=default]:p-0.5",
    );
    expect(defaultSwitch.firstElementChild).toHaveClass(
      "group-data-[size=default]/switch:size-5",
      "group-data-[size=default]/switch:data-[state=checked]:translate-x-4",
    );

    const smallSwitch = screen.getByRole("switch", { name: "Small size" });
    expect(smallSwitch).toHaveAttribute("data-size", "sm");
    expect(smallSwitch).toHaveClass("data-[size=sm]:h-4", "data-[size=sm]:w-7", "data-[size=sm]:p-px");
    expect(smallSwitch.firstElementChild).toHaveClass(
      "group-data-[size=sm]/switch:size-3",
      "group-data-[size=sm]/switch:data-[state=checked]:translate-x-3",
    );
  });
});

// ─── Modal ─────────────────────────────────────────────────────────────────

describe("Modal", () => {
  it("renders with the given title as dialog label", () => {
    render(
      <Modal title="My Modal" onClose={vi.fn()}>
        <p>Content</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "My Modal" })).toHaveClass("bg-popover");
    expect(screen.getByRole("dialog", { name: "My Modal" })).not.toHaveClass("bg-background");
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("exposes the title as a navigable heading (aria-labelledby)", () => {
    render(
      <Modal title="Heady" onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("heading", { name: "Heady" })).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Esc Modal" onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Backdrop Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    );
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ["right-click", { button: 2 }],
    ["macOS ctrl-click", { button: 0, ctrlKey: true }],
  ])("does not treat a %s on the backdrop as a dismissal", async (_gesture, pointer) => {
    const onClose = vi.fn();
    render(
      <Modal title="Context menu Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    );

    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    fireEvent.pointerDown(backdrop, { pointerType: "mouse", ...pointer });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when its content is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Backdrop Modal" onClose={onClose}>
        <p>Inner</p>
      </Modal>,
    );
    await user.click(screen.getByText("Inner"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses an accidental backdrop/Escape dismissal once a field is edited", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Dirty Modal" onClose={onClose}>
        <input aria-label="field" />
      </Modal>,
    );
    // Edit a field → dialog is dirty.
    fireEvent.input(screen.getByLabelText("field"), { target: { value: "x" } });
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    await user.click(backdrop);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("publishes one controlled dirty transition when one edit surfaces as input and change", () => {
    const onDirtyChange = vi.fn();
    render(
      <Modal title="Controlled dirty" onClose={vi.fn()} dirty={false} onDirtyChange={onDirtyChange}>
        <input aria-label="controlled field" />
      </Modal>,
    );
    const field = screen.getByLabelText("controlled field");
    fireEvent.input(field, { target: { value: "x" } });
    fireEvent.change(field, { target: { value: "x" } });
    expect(onDirtyChange).toHaveBeenCalledOnce();
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("guards an immediate Escape before controlled dirty state has re-rendered", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Controlled dirty" onClose={onClose} dirty={false} onDirtyChange={vi.fn()}>
        <input aria-label="controlled field" />
      </Modal>,
    );

    fireEvent.input(screen.getByLabelText("controlled field"), {
      target: { value: "x" },
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps one editor globally dirty while a clean overlapping Modal mounts and unmounts", () => {
    const modals = (showCleanOverlay: boolean) => (
      <>
        <Modal key="editor" title="Dirty editor" onClose={vi.fn()}>
          <input aria-label="edited field" />
        </Modal>
        {showCleanOverlay && (
          <Modal key="overlay" title="Clean overlay" onClose={vi.fn()} guardDirty={false}>
            <p>Hint only</p>
          </Modal>
        )}
      </>
    );
    const { rerender, unmount } = render(modals(false));

    fireEvent.input(screen.getByLabelText("edited field"), {
      target: { value: "unsaved" },
    });
    expect(useStore.getState().dirtyForm).toBe(true);

    rerender(modals(true));
    expect(screen.getByRole("dialog", { name: "Clean overlay" })).toBeInTheDocument();
    expect(useStore.getState().dirtyForm).toBe(true);

    rerender(modals(false));
    expect(screen.queryByRole("dialog", { name: "Clean overlay" })).not.toBeInTheDocument();
    expect(useStore.getState().dirtyForm).toBe(true);

    unmount();
    expect(useStore.getState().dirtyForm).toBe(false);
  });

  it("treats clicking an aria-pressed toggle (e.g. WeekdayPicker) as a dirty edit", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Toggle Modal" onClose={onClose}>
        <button type="button" aria-pressed={false}>
          Mon
        </button>
      </Modal>,
    );
    // A button-driven toggle fires no input/change event, but the guard must still
    // catch it — otherwise editing working days then pressing Escape loses the change.
    fireEvent.click(screen.getByRole("button", { name: "Mon" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not mark an explicitly-managed segmented control dirty when its value is unchanged", () => {
    const onClose = vi.fn();
    render(
      <Modal title="No-op segment" onClose={onClose}>
        <SegmentedControl
          value="week"
          onChange={vi.fn()}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
          ariaLabel="Zoom"
        />
      </Modal>,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Week" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("applies the connected outline shadow selector to the numeric default spacing", () => {
    render(
      <SegmentedControl
        value="week"
        onChange={vi.fn()}
        options={[
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
        ]}
        ariaLabel="Zoom"
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Zoom" });
    expect(group).toHaveAttribute("data-spacing", "0");
    expect(group).toHaveAttribute("data-variant", "outline");
    expect(group).toHaveClass("data-[spacing=0]:data-[variant=outline]:shadow-xs");
    expect(group).not.toHaveClass("data-[spacing=default]:data-[variant=outline]:shadow-xs");
  });

  it("keeps the selected outline one pixel thick at every connected position", () => {
    const options = [
      { value: "first", label: "First" },
      { value: "middle", label: "Middle" },
      { value: "last", label: "Last" },
    ];
    const control = (value: string) => (
      <SegmentedControl value={value} onChange={vi.fn()} options={options} ariaLabel="Positions" />
    );
    const { rerender } = render(control("first"));

    for (const selectedOption of options) {
      rerender(control(selectedOption.value));
      const selected = screen.getByRole("radio", { name: selectedOption.label });
      expect(selected).toHaveAttribute("data-state", "on");
      expect(selected).toHaveClass("data-[state=on]:border-brand", "data-[state=on]:z-10");
      expect(selected).toHaveClass(
        "data-[spacing=0]:not-first:data-[state=on]:shadow-[inset_1px_0_0_var(--color-brand)]",
      );
      expect(selected).not.toHaveClass("data-[spacing=0]:data-[state=on]:shadow-[inset_0_0_0_1px_var(--color-brand)]");
    }
  });

  it("round-trips numeric and string values that have the same display text", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value={1 as 1 | "1"}
        onChange={onChange}
        options={[
          { value: 1, label: "Number one" },
          { value: "1", label: "String one" },
        ]}
        ariaLabel="Mixed values"
      />,
    );

    expect(screen.getByRole("radio", { name: "Number one" })).toHaveAttribute("data-state", "on");
    fireEvent.click(screen.getByRole("radio", { name: "String one" }));
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("does not mark an explicitly-managed colour picker dirty when the selected swatch is re-picked", () => {
    const onClose = vi.fn();
    const blue = "#2d75da";
    render(
      <Modal title="No-op colour" onClose={onClose}>
        <ColorField label="Colour" value={blue} onChange={vi.fn()} />
      </Modal>,
    );

    fireEvent.click(screen.getByRole("button", { name: `Colour (${colorName(blue)})` }));
    fireEvent.click(screen.getByRole("radio", { name: colorName(blue) }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders optional footer", () => {
    render(
      <Modal title="Footer Modal" onClose={vi.fn()} footer={<span>Footer content</span>}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByText("Footer content")).toBeInTheDocument();
  });

  it("keeps focus stable and restores it when onClose identity churns mid-open", () => {
    // Simulate a real trigger having focus before the dialog opens.
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const body = (
      <>
        <button>First</button>
        <button>Second</button>
      </>
    );
    const { rerender, unmount } = render(
      <Modal title="Churn" onClose={() => {}}>
        {body}
      </Modal>,
    );
    const first = screen.getByRole("button", { name: "First" });
    const second = screen.getByRole("button", { name: "Second" });
    expect(document.activeElement).toBe(first); // focuses first control on open

    second.focus();
    // Parent re-renders with a BRAND-NEW onClose (as a store mutation would cause).
    rerender(
      <Modal title="Churn" onClose={() => {}}>
        {body}
      </Modal>,
    );
    expect(document.activeElement).toBe(second); // focus not yanked back to first

    unmount();
    expect(document.activeElement).toBe(trigger); // focus returns to the opener
    trigger.remove();
  });
});

// ─── ConfirmDialog ─────────────────────────────────────────────────────────

describe("ConfirmDialog", () => {
  it("renders title and message", () => {
    render(
      <ConfirmDialog title="Really delete?" message="This cannot be undone." onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole("alertdialog", { name: "Really delete?" })).toHaveClass("bg-popover");
    expect(screen.getByRole("alertdialog", { name: "Really delete?" })).not.toHaveClass("bg-background");
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Confirm" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when the Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Confirm" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("uses a custom confirmLabel", () => {
    render(
      <ConfirmDialog
        title="Remove?"
        message="This will remove it."
        confirmLabel="Remove"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("disables cancellation and confirmation while an async owner is busy", () => {
    render(<ConfirmDialog title="Confirm" message="Sure?" busy onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});

// ─── ListPage ──────────────────────────────────────────────────────────────

describe("ListPage", () => {
  it("renders the page title", () => {
    render(<ListPage title="My Page" />);
    expect(screen.getByRole("heading", { name: "My Page" })).toBeInTheDocument();
  });

  it("renders children", () => {
    render(
      <ListPage title="Page">
        <p>Child content</p>
      </ListPage>,
    );
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });

  it("renders Add button with default label when onAdd is provided", () => {
    const onAdd = vi.fn();
    render(<ListPage title="Page" onAdd={onAdd} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("calls onAdd when the Add button is clicked", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ListPage title="Page" onAdd={onAdd} />);
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("uses a custom addLabel", () => {
    const onAdd = vi.fn();
    render(<ListPage title="Page" onAdd={onAdd} addLabel="New item" />);
    expect(screen.getByRole("button", { name: "New item" })).toBeInTheDocument();
  });

  it("does not render an Add button when onAdd is not provided", () => {
    render(<ListPage title="Page" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

// ─── EmptyState ────────────────────────────────────────────────────────────

describe("EmptyState", () => {
  it("renders children text", () => {
    render(<EmptyState>No items yet.</EmptyState>);
    expect(screen.getByText("No items yet.")).toBeInTheDocument();
  });

  it("keeps EmptyDescription paragraph props and refs aligned with its DOM element", () => {
    const ref = createRef<HTMLParagraphElement>();
    render(<EmptyDescription ref={ref}>Nothing scheduled.</EmptyDescription>);

    expect(ref.current).toBeInstanceOf(HTMLParagraphElement);
    expect(ref.current?.tagName).toBe("P");
  });
});

// ─── FieldError ────────────────────────────────────────────────────────────

describe("FieldError", () => {
  it("renders alert with the error message when children provided", () => {
    render(<FieldError>Name is required</FieldError>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Name is required");
  });

  it("renders nothing when children is undefined", () => {
    const { container } = render(<FieldError />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when children is empty string", () => {
    const { container } = render(<FieldError>{""}</FieldError>);
    expect(container).toBeEmptyDOMElement();
  });
});

// ─── TextField ─────────────────────────────────────────────────────────────

describe("TextField", () => {
  it("renders with label and value", () => {
    render(<TextField label="Full name" value="Alice" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Full name")).toHaveValue("Alice");
  });

  it("calls onChange on each keystroke", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Name" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText("Name"), "B");
    expect(onChange).toHaveBeenCalledWith("B");
  });

  it("renders placeholder text", () => {
    render(<TextField label="Search" value="" onChange={vi.fn()} placeholder="Type here..." />);
    expect(screen.getByPlaceholderText("Type here...")).toBeInTheDocument();
  });
});

// ─── TextAreaField ─────────────────────────────────────────────────────────

describe("TextAreaField", () => {
  it("renders with label and value", () => {
    render(<TextAreaField label="Notes" value="Some notes" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Notes")).toHaveValue("Some notes");
  });

  it("calls onChange on each keystroke", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextAreaField label="Notes" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText("Notes"), "H");
    expect(onChange).toHaveBeenCalledWith("H");
  });
});

// ─── NumberField ───────────────────────────────────────────────────────────

describe("NumberField", () => {
  it("renders with label and numeric value", () => {
    render(<NumberField label="Hours" value={8} onChange={vi.fn()} />);
    expect(screen.getByLabelText("Hours")).toHaveValue(8);
  });

  it("calls onChange with a number on change", () => {
    const onChange = vi.fn();
    render(<NumberField label="Qty" value={5} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Qty"), { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith(10);
  });
});

// ─── DateField ─────────────────────────────────────────────────────────────

describe("DateField", () => {
  it("renders with label and date value", () => {
    render(<DateField label="Start date" value="2026-06-01" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-06-01");
  });

  it("calls onChange with new date string", () => {
    const onChange = vi.fn();
    render(<DateField label="End date" value="2026-06-01" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("End date"), {
      target: { value: "2026-07-01" },
    });
    expect(onChange).toHaveBeenCalledWith("2026-07-01");
  });
});

// ─── SelectField ───────────────────────────────────────────────────────────

describe("SelectField", () => {
  const options = [
    { value: "a", label: "Option A" },
    { value: "b", label: "Option B" },
    { value: "c", label: "Option C" },
  ];

  it("renders all options", () => {
    render(<SelectField label="Pick one" value="a" onChange={vi.fn()} options={options} />);
    const select = screen.getByLabelText("Pick one");
    expect(select).toBeInTheDocument();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Option B" })).toHaveAttribute("data-value", "b");
    expect(screen.getByRole("option", { name: "Option C" })).toBeInTheDocument();
  });

  it("calls onChange when an option is selected", () => {
    const onChange = vi.fn();
    render(<SelectField label="Pick one" value="a" onChange={onChange} options={options} />);
    const select = screen.getByLabelText("Pick one");
    select.focus();
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Option B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("round-trips empty and sentinel-shaped option values without collision", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectField
        label="Collision-safe"
        value=""
        onChange={onChange}
        options={[
          { value: "", label: "None" },
          { value: "__capacitylens_empty__", label: "Sentinel-shaped id" },
        ]}
      />,
    );

    const select = screen.getByLabelText("Collision-safe");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Sentinel-shaped id" }));
    expect(onChange).toHaveBeenLastCalledWith("__capacitylens_empty__");

    rerender(
      <SelectField
        label="Collision-safe"
        value="__capacitylens_empty__"
        onChange={onChange}
        options={[
          { value: "", label: "None" },
          { value: "__capacitylens_empty__", label: "Sentinel-shaped id" },
        ]}
      />,
    );
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "None" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("marks a changed selection dirty inside a Modal", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Select modal" onClose={onClose}>
        <SelectField label="Pick one" value="a" onChange={vi.fn()} options={options} />
      </Modal>,
    );
    const select = screen.getByLabelText("Pick one");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Option B" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders a placeholder option when provided", () => {
    render(<SelectField label="Choose" value="" onChange={vi.fn()} options={options} placeholder="-- Select --" />);
    expect(screen.getByText("-- Select --")).toBeInTheDocument();
  });

  it("surfaces a non-empty value that is absent from the supplied options", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectField label="Unresolved" value="missing-id" onChange={onChange} options={options} />,
    );
    expect(screen.getByLabelText("Unresolved")).toHaveTextContent("missing-id");
    expect(onChange).not.toHaveBeenCalled();

    rerender(
      <SelectField
        label="Unresolved"
        value="missing-id"
        onChange={onChange}
        options={options}
        placeholder="Unknown selection"
      />,
    );
    expect(screen.getByLabelText("Unresolved")).toHaveTextContent("Unknown selection");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is disabled when disabled prop is true", () => {
    render(<SelectField label="Locked" value="a" onChange={vi.fn()} options={options} disabled />);
    expect(screen.getByLabelText("Locked")).toBeDisabled();
  });
});

// ─── ColorField ────────────────────────────────────────────────────────────

describe("ColorField", () => {
  // Two real members of SWATCHES: a blue (also the default client colour) and a red.
  const BLUE = "#2d75da";
  const RED = "#e02727";

  it("renders a trigger labelled with the current value and no swatches until opened", () => {
    render(<ColorField label="Brand colour" value={BLUE} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: `Brand colour (${colorName(BLUE)})` })).toBeInTheDocument();
    // Popup is closed → preset swatches are not in the DOM.
    expect(screen.queryByRole("radio", { name: colorName(RED) })).not.toBeInTheDocument();
  });

  it("opens the full grid of preset swatches when the trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<ColorField label="Colour" value={BLUE} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", {
      name: `Colour (${colorName(BLUE)})`,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("radiogroup", { name: "Colour swatches" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(52);
  });

  it("toggles the swatch grid closed when its expanded trigger is clicked again", async () => {
    const user = userEvent.setup();
    render(<ColorField label="Colour" value={BLUE} onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: `Colour (${colorName(BLUE)})` });

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("radio", { name: colorName(RED) })).not.toBeInTheDocument();
  });

  it("calls onChange with the chosen hex and closes the popup", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField label="Colour" value={BLUE} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: `Colour (${colorName(BLUE)})` }));
    await user.click(screen.getByRole("radio", { name: colorName(RED) }));
    expect(onChange).toHaveBeenCalledWith(RED);
    // Picking closes the popup.
    expect(screen.queryByRole("radio", { name: colorName(RED) })).not.toBeInTheDocument();
  });

  it("exposes the swatches as one single-select radio group", async () => {
    const user = userEvent.setup();
    render(<ColorField label="Colour" value={BLUE} onChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: `Colour (${colorName(BLUE)})` }));
    expect(screen.getByRole("radio", { name: colorName(BLUE) })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: colorName(RED) })).toHaveAttribute("aria-checked", "false");
  });

  it("uses one tab stop and arrow keys to move through the swatch grid", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ColorField label="Colour" value={BLUE} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: `Colour (${colorName(BLUE)})` }));
    const selected = screen.getByRole("radio", { name: colorName(BLUE) });
    const swatches = screen.getAllByRole("radio");
    expect(swatches.filter((button) => button.tabIndex === 0)).toEqual([selected]);
    selected.focus();
    await user.keyboard("{ArrowRight}");
    const next = swatches[(swatches.indexOf(selected) + 1) % swatches.length];
    expect(document.activeElement).toBe(next);
    expect(onChange).toHaveBeenCalledWith(SWATCHES[(SWATCHES.indexOf(BLUE) + 1) % SWATCHES.length]);
  });

  it("closes the popup on an outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <ColorField label="Colour" value={BLUE} onChange={vi.fn()} />
        <button type="button">Outside</button>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: `Colour (${colorName(BLUE)})` }));
    expect(screen.getByRole("radio", { name: colorName(RED) })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("radio", { name: colorName(RED) })).not.toBeInTheDocument();
  });

  it("closes the popup on Escape without closing the surrounding Modal", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Edit" onClose={onClose}>
        <ColorField label="Colour" value={BLUE} onChange={vi.fn()} />
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: `Colour (${colorName(BLUE)})` }));
    // Move focus into the grid, then Escape: the popup must close and the keydown must
    // not reach the surrounding handler (the Modal's Escape-to-close in real use).
    const swatch = screen.getByRole("radio", { name: colorName(RED) });
    swatch.focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("radio", { name: colorName(RED) })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses only the popup, not the surrounding Modal, on a backdrop click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal title="Edit" onClose={onClose}>
        <ColorField label="Colour" value={BLUE} onChange={vi.fn()} />
      </Modal>,
    );
    await user.click(screen.getByRole("button", { name: `Colour (${colorName(BLUE)})` }));
    expect(screen.getByRole("radio", { name: colorName(RED) })).toBeInTheDocument();
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!;
    await user.click(backdrop);
    expect(screen.queryByRole("radio", { name: colorName(RED) })).not.toBeInTheDocument(); // popup closed
    expect(onClose).not.toHaveBeenCalled(); // modal stayed open
  });

  it("does NOT swallow a press on another control inside the same dialog (first click lands)", async () => {
    const user = userEvent.setup();
    const onSiblingDown = vi.fn();
    render(
      <Modal title="Edit" onClose={() => {}}>
        <ColorField label="Colour" value={BLUE} onChange={vi.fn()} />
        <button type="button" data-testid="sibling" onMouseDown={onSiblingDown}>
          Other field
        </button>
      </Modal>,
    );
    fireEvent.click(screen.getByRole("button", { name: `Colour (${colorName(BLUE)})` }));
    expect(screen.getByRole("radio", { name: colorName(RED) })).toBeInTheDocument(); // popup open
    // A press on another in-dialog control must reach it while Popover handles dismissal.
    await user.click(screen.getByTestId("sibling"));
    expect(onSiblingDown).toHaveBeenCalledTimes(1); // not swallowed
    expect(screen.queryByRole("radio", { name: colorName(RED) })).not.toBeInTheDocument(); // popup closed
  });
});

// ─── WeekdayPicker ─────────────────────────────────────────────────────────

describe("WeekdayPicker", () => {
  it("renders all 7 day buttons", () => {
    render(<WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={vi.fn()} />);
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(screen.getByRole("button", { name: day })).toBeInTheDocument();
    }
  });

  it("marks selected days as pressed", () => {
    render(<WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Sun" })).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles a day ON when it is not selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Sat" }));
    // Sat is day 6 — should be added
    expect(onChange).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6]);
  });

  it("toggles a day OFF when it is already selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Mon" }));
    // Mon is day 1 — should be removed
    expect(onChange).toHaveBeenCalledWith([2, 3, 4, 5]);
  });

  it("does NOT set aria-invalid/aria-describedby on the fieldset when valid", () => {
    const { container } = render(<WeekdayPicker label="Working days" value={[1, 2, 3, 4, 5]} onChange={vi.fn()} />);
    const fieldset = container.querySelector("fieldset")!;
    expect(fieldset).not.toHaveAttribute("aria-invalid");
    expect(fieldset).not.toHaveAttribute("aria-describedby");
  });

  it("marks the GROUP errored (aria-invalid + aria-describedby) when invalid, mirroring sibling fields (WCAG 3.3.1)", () => {
    const { container } = render(
      <WeekdayPicker label="Working days" value={[]} onChange={vi.fn()} invalid describedById="err-1" />,
    );
    const fieldset = container.querySelector("fieldset")!;
    expect(fieldset).toHaveAttribute("aria-invalid", "true");
    expect(fieldset).toHaveAttribute("aria-describedby", "err-1");
  });
});

// ─── ColorSwatch ───────────────────────────────────────────────────────────

describe("ColorSwatch", () => {
  it("renders a span with the given background color", () => {
    const { container } = render(<ColorSwatch color="#ec4899" />);
    const swatch = container.firstChild as HTMLElement;
    expect(swatch).toBeInTheDocument();
    expect(swatch.style.backgroundColor).toBe("rgb(236, 72, 153)");
  });
});

// ─── Avatar ────────────────────────────────────────────────────────────────

describe("Avatar", () => {
  it("shows two-initial monogram from a full name", () => {
    const { container } = render(<Avatar name="Alice Smith" color="#111" />);
    expect(container.firstChild).toHaveTextContent("AS");
  });

  it("shows single initial from a single-word name", () => {
    const { container } = render(<Avatar name="Alice" color="#111" />);
    expect(container.firstChild).toHaveTextContent("A");
  });

  it("shows only first two initials from a long name", () => {
    const { container } = render(<Avatar name="Alice Bob Carol" color="#111" />);
    expect(container.firstChild).toHaveTextContent("AB");
  });

  it("shows initials in uppercase", () => {
    const { container } = render(<Avatar name="alice smith" color="#111" />);
    expect(container.firstChild).toHaveTextContent("AS");
  });

  it("keeps an astral-plane leading character intact in initials", () => {
    const { container } = render(<Avatar name="🚀 Studio" color="#111" />);
    expect(container.firstChild).toHaveTextContent("🚀S");
  });

  it("shows em dash fallback for an empty name", () => {
    const { container } = render(<Avatar name="" color="#111" />);
    expect(container.firstChild).toHaveTextContent("—");
  });

  it("renders with the given background color", () => {
    const { container } = render(<Avatar name="Alice Smith" color="#ec4899" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.backgroundColor).toBe("rgb(236, 72, 153)");
  });

  it("renders no photo <img> when no imageUrl is given (initials only)", () => {
    const { container } = render(<Avatar name="Alice Smith" color="#111" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstChild).toHaveTextContent("AS");
  });

  it("keeps the initials fallback while an imageUrl is still loading", () => {
    // jsdom never resolves the Radix image load, so the primitive stays on its fallback — the
    // signed-in user sees initials (never an empty circle) until the photo resolves.
    const { container } = render(<Avatar name="Alice Smith" color="#111" imageUrl="https://cdn.example/a.png" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstChild).toHaveTextContent("AS");
  });

  it("renders the photo <img> from imageUrl once it loads", () => {
    // Radix mounts the <img> only after the image reports "loaded"; stub window.Image so the
    // synchronous load-status probe returns "loaded" in jsdom (complete + non-zero naturalWidth).
    class LoadedImage {
      complete = true;
      naturalWidth = 1;
      crossOrigin: string | null = null;
      referrerPolicy = "";
      src = "";
      addEventListener() {}
      removeEventListener() {}
    }
    vi.stubGlobal("Image", LoadedImage);
    try {
      const { container } = render(<Avatar name="Alice Smith" color="#111" imageUrl="https://cdn.example/a.png" />);
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute("src", "https://cdn.example/a.png");
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveClass("object-cover");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
