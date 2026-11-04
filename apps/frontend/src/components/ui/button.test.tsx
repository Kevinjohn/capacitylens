import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@/components/ui/button";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

describe("Button", () => {
  registerButtonAppearanceTests();
  registerButtonFeedbackTests();
});

function registerButtonAppearanceTests() {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(
      screen.getByRole("button", { name: "Click me" }),
    ).toBeInTheDocument();
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

    const button = screen.getByRole("button", { name: "Primary" });
    expect(button).toBeInTheDocument();
    // Opacity must switch immediately when disabled clears. Transitioning every property briefly
    // creates an enabled, semi-transparent button whose text fails WCAG contrast after a request.
    expect(button).toHaveClass("transition-colors");
    expect(button).not.toHaveClass("transition-all");
  });

  it("signals enabled buttons and links as clickable without making disabled controls look enabled", () => {
    const { rerender } = render(
      <Button asChild>
        <a href="/archived">Archived</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Archived" })).toHaveClass(
      "[&:not(:disabled)]:cursor-pointer",
    );
    rerender(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button", { name: "Disabled" })).not.toHaveClass(
      "cursor-pointer",
    );
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
    expect(screen.getByRole("button", { name: "Primary" })).toHaveClass(
      "bg-ok-strong",
      "text-ok-strong-ink",
    );
    expect(screen.getByRole("button", { name: "Danger" })).toHaveClass(
      "bg-danger-soft",
      "text-danger-soft-ink",
    );
  });

  it.each([
    "default",
    "danger-soft",
    "destructive",
    "outline",
    "secondary",
    "ghost",
  ] as const)(
    "gives the %s variant enabled-only pressed feedback",
    (variant) => {
      render(<Button variant={variant}>{variant}</Button>);

      expect(screen.getByRole("button", { name: variant })).toHaveClass(
        "enabled:active:scale-95",
      );
    },
  );
}

function registerButtonFeedbackTests() {
  it("keeps link-styled actions out of the button press treatment", () => {
    render(<Button variant="link">Learn more</Button>);

    expect(screen.getByRole("button", { name: "Learn more" })).not.toHaveClass(
      "enabled:active:scale-95",
    );
  });

  it("gives icon buttons the same enabled-only pressed feedback", () => {
    render(
      <Button size="icon" aria-label="Previous week">
        ←
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Previous week" })).toHaveClass(
      "enabled:active:scale-95",
    );
  });

  it("does not expose the pressed transform on disabled buttons", () => {
    render(<Button disabled>Unavailable</Button>);

    const button = screen.getByRole("button", { name: "Unavailable" });
    expect(button).toHaveClass(
      "enabled:active:scale-95",
      "disabled:pointer-events-none",
    );
    expect(button).not.toHaveClass("active:scale-95");
  });
}
