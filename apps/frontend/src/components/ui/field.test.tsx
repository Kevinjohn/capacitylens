import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldError } from "@/components/ui/field";
import { useStore } from "@/store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";

beforeEach(() => {
  useStore.getState().replaceAll(emptyAppData());
  useStore.getState().clearFilters();
  useStore.getState().setDirtyForm(false);
});

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
