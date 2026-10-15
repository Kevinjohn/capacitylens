import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFieldError, useFieldErrorFocus } from "./useFieldError";

function FocusHarness({ formLevel = false }: { formLevel?: boolean }) {
  const fieldError = useFieldError();
  useFieldErrorFocus(fieldError);
  return (
    <>
      <input aria-label="Name" aria-describedby={fieldError.errorField === "name" ? fieldError.errorId : undefined} />
      <button type="button" onClick={() => fieldError.fail(formLevel ? null : "name", "Fix this value.")}>
        Fail
      </button>
      {fieldError.error && (
        <p id={fieldError.errorId} role="alert" tabIndex={fieldError.errorField === null ? -1 : undefined}>
          {fieldError.error}
        </p>
      )}
    </>
  );
}

describe("useFieldError", () => {
  it("clears both the message and its stale field association", () => {
    const { result, rerender } = renderHook(() => useFieldError());
    const clear = result.current.clear;

    act(() => result.current.fail("name", "Name is required."));
    expect(result.current).toMatchObject({ error: "Name is required.", errorField: "name" });

    act(() => result.current.clear());
    expect(result.current).toMatchObject({ error: null, errorField: null });
    rerender();
    expect(result.current.clear).toBe(clear);
  });

  it("focuses the invalid field after reporting its associated error", () => {
    render(<FocusHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("focuses the alert when the error belongs to the whole form", () => {
    render(<FocusHarness formLevel />);
    fireEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});
