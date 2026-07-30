import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { RouteLoading, router } from "./router";

describe("router loading boundary", () => {
  it("keeps top-level lazy routes inside a visible main landmark", () => {
    render(<RouteLoading />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});

describe("router not-found recovery", () => {
  it("renders the branded recovery screen for an unmatched URL", async () => {
    document.title = "CapacityLens";
    await act(async () => {
      await router.navigate("/stale-bookmark-that-does-not-exist");
    });

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText("That page does not exist or may have moved.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to schedule" })).toHaveAttribute("href", "/");
    expect(document.title).toBe("Page not found · CapacityLens");
  });
});
