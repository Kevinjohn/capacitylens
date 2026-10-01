import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { Avatar } from "./ui";

describe("Avatar", () => {
  registerAvatarInitialTests();
  registerAvatarImageTests();
});

function registerAvatarInitialTests() {
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
}

function registerAvatarImageTests() {
  it("keeps the initials fallback while an imageUrl is still loading", () => {
    // jsdom never resolves the Radix image load, so the primitive stays on its fallback — the
    // signed-in user sees initials (never an empty circle) until the photo resolves.
    const { container } = render(<Avatar name="Alice Smith" color="#111" imageUrl="https://cdn.example/a.png" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstChild).toHaveTextContent("AS");
  });

  it("renders the photo <img> from imageUrl once it loads", () => {
    // Stub Image as loaded (complete + non-zero naturalWidth) so Radix mounts the photo in jsdom.
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
      expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(img).toHaveClass("object-cover");
    } finally {
      vi.unstubAllGlobals();
    }
  });
}
