// @vitest-environment jsdom
// jsdom has no AnimationEvent, so React would not listen for animationend at all.
vi.hoisted(() => {
  (globalThis as unknown as { AnimationEvent: unknown }).AnimationEvent = class extends Event {};
});
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "@/ui/app-shell/presence";

function Card({ fallback }: { fallback?: () => HTMLElement | null }) {
  const [open, setOpen] = useState<true | null>(true);
  const { shown, props } = usePresence(open, fallback);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <p tabIndex={-1} data-testid="target">
        target
      </p>
      {shown ? (
        <div data-testid="card" {...props}>
          <button type="button" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

const motion = (reduced: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduced && q.includes("reduced-motion") }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("usePresence", () => {
  it("under reduced motion the node goes at once and focus moves to the fallback", () => {
    motion(true);
    render(<Card fallback={() => screen.getByTestId("target")} />);
    screen.getByRole("button", { name: "Close" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("card")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("target"));
  });

  it("while it exits the node is inert and hidden, focus has already moved, and animationend removes it", () => {
    motion(false);
    render(<Card fallback={() => screen.getByTestId("target")} />);
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.click(close);
    const card = screen.getByTestId("card");
    expect(card.getAttribute("data-exiting")).toBe("true");
    expect(card.hasAttribute("inert")).toBe(true);
    expect(card.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(screen.getByTestId("target"));
    act(() => {
      card.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect(screen.queryByTestId("card")).toBeNull();
  });

  it("leaves focus alone when it was not inside the node", () => {
    motion(true);
    render(<Card fallback={() => screen.getByTestId("target")} />);
    screen.getByRole("button", { name: "Open" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open" }));
  });
});
