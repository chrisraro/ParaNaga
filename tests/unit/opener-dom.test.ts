// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureOpener, cycleTab } from "@/ui/kit/opener";

// jsdom lays nothing out: every element counts as rendered unless it is marked data-gone.
beforeEach(() => {
  Object.defineProperty(Element.prototype, "checkVisibility", {
    configurable: true,
    value(this: Element) {
      return !this.closest("[data-gone]");
    },
  });
});
afterEach(() => {
  document.body.innerHTML = "";
});

const tab = (shiftKey = false, extra: KeyboardEventInit = {}) => new KeyboardEvent("keydown", { key: "Tab", shiftKey, cancelable: true, ...extra });

describe("cycleTab", () => {
  it("wraps forward and backward through the container", () => {
    document.body.innerHTML = '<div id="c"><button id="a"></button><button id="b"></button></div>';
    const c = document.getElementById("c")!;
    document.getElementById("b")!.focus();
    cycleTab(tab(), c);
    expect(document.activeElement?.id).toBe("a");
    cycleTab(tab(true), c);
    expect(document.activeElement?.id).toBe("b");
  });
  it("skips an entry that is not rendered instead of sticking on it", () => {
    document.body.innerHTML = '<div id="c"><button id="a"></button><button id="x" data-gone></button><button id="b"></button></div>';
    const c = document.getElementById("c")!;
    document.getElementById("a")!.focus();
    cycleTab(tab(), c);
    expect(document.activeElement?.id).toBe("b");
  });
  it("advances past an entry that refuses focus", () => {
    document.body.innerHTML = '<div id="c"><button id="a"></button><button id="x"></button><button id="b"></button></div>';
    const x = document.getElementById("x")!;
    x.focus = () => undefined;
    document.getElementById("a")!.focus();
    cycleTab(tab(), document.getElementById("c"));
    expect(document.activeElement?.id).toBe("b");
  });
  it("keeps focus on a single focusable control and enters from outside", () => {
    document.body.innerHTML = '<button id="o"></button><div id="c"><button id="a"></button></div>';
    const c = document.getElementById("c")!;
    document.getElementById("a")!.focus();
    cycleTab(tab(), c);
    expect(document.activeElement?.id).toBe("a");
    document.getElementById("o")!.focus();
    cycleTab(tab(true), c);
    expect(document.activeElement?.id).toBe("a");
  });
  it("leaves ctrl/alt/meta chords and handled events alone", () => {
    document.body.innerHTML = '<div id="c"><button id="a"></button><button id="b"></button></div>';
    const c = document.getElementById("c")!;
    document.getElementById("a")!.focus();
    const chord = tab(false, { ctrlKey: true });
    cycleTab(chord, c);
    expect(chord.defaultPrevented).toBe(false);
    const handled = tab();
    handled.preventDefault();
    cycleTab(handled, c);
    expect(document.activeElement?.id).toBe("a");
  });
});

describe("captureOpener", () => {
  it("returns the clicked control when focus stayed on body (Safari)", () => {
    document.body.innerHTML = '<button id="a"><span id="s"></span></button>';
    (document.activeElement as HTMLElement | null)?.blur();
    document.getElementById("s")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(captureOpener()?.id).toBe("a");
  });
  it("prefers the focused control (keyboard)", () => {
    document.body.innerHTML = '<button id="a"></button><button id="b"></button>';
    document.getElementById("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("b")!.focus();
    expect(captureOpener()?.id).toBe("b");
  });
});
