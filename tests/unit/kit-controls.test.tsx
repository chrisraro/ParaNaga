// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented } from "@/ui/kit/segmented";
import { Switch } from "@/ui/kit/switch";

afterEach(cleanup);

function SwitchHarness({ onChange }: { onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(false);
  return (
    <Switch
      label="Low-data mode"
      hint="Smaller map tiles."
      checked={on}
      onChange={(v) => {
        setOn(v);
        onChange?.(v);
      }}
    />
  );
}

describe("Switch", () => {
  it("is a named switch whose click toggles aria-checked", () => {
    render(<SwitchHarness />);
    const sw = screen.getByRole("switch", { name: "Low-data mode" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("toggles from its label too, and is described by its hint", () => {
    const onChange = vi.fn();
    render(<SwitchHarness onChange={onChange} />);
    fireEvent.click(screen.getByText("Low-data mode"));
    expect(onChange).toHaveBeenCalledWith(true);
    const sw = screen.getByRole("switch");
    expect(document.getElementById(sw.getAttribute("aria-describedby")!)?.textContent).toBe("Smaller map tiles.");
  });
});

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;
type Theme = (typeof THEMES)[number]["value"];

function SegHarness({ variant }: { variant?: "radiogroup" | "tablist" }) {
  const [value, setValue] = useState<Theme>("system");
  return <Segmented options={THEMES} value={value} onChange={setValue} label="Appearance" variant={variant} />;
}

describe("Segmented", () => {
  it("radiogroup: one tab stop, arrow keys move and choose, wrapping at the ends", () => {
    render(<SegHarness />);
    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);

    act(() => radios[0]!.focus());
    fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Light" }));
    expect((group as HTMLElement).style.getPropertyValue("--pn-seg-index")).toBe("1");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("tablist: tabs with aria-selected, chosen by click", () => {
    render(<SegHarness variant="tablist" />);
    expect(screen.getByRole("tablist", { name: "Appearance" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Dark" }));
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(screen.getByRole("tab", { name: "Dark" }).hasAttribute("aria-checked")).toBe(false);
  });
});
