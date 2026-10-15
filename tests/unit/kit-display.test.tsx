// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UNVERIFIED_ROUTE_BADGE } from "@/domain/planner/labels";
import { activeTab } from "@/ui/app-shell/tab-bar";
import { StatusBadge, badgeText, type BadgeVariant } from "@/ui/kit/badge";
import { ConfirmDialog } from "@/ui/kit/confirm-dialog";
import { ListCell, ListGroup } from "@/ui/kit/list";
import { Note } from "@/ui/kit/note";
import { OSM_COPYRIGHT_URL, OsmAttribution } from "@/ui/kit/osm-attribution";

afterEach(cleanup);

describe("StatusBadge", () => {
  const expected: Record<BadgeVariant, string> = {
    verified: "Verified",
    candidate: "Mapped candidate",
    documented: "Documented only",
    trial: "Trial — permanence unconfirmed",
    "unverified-route": UNVERIFIED_ROUTE_BADGE,
    "not-surveyed": "Not surveyed",
    historical: "Historical name — not mapped",
    osm: "OpenStreetMap",
    "provisional-stops": "Provisional stops",
  };

  it.each(Object.entries(expected))("%s renders its text with an icon (never colour alone)", (variant, text) => {
    const { container } = render(<StatusBadge variant={variant as BadgeVariant} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.textContent).toBe(text);
    expect(badgeText(variant as BadgeVariant)).toBe(text);
    const icon = badge.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ListGroup / ListCell", () => {
  it("renders a titled group of link, button and static cells; actionable cells get a chevron", () => {
    const onClick = vi.fn();
    render(
      <ListGroup title="Routes">
        <ListCell href="/app/routes/R1" title="Centro" sub="R1 · Documented only" />
        <ListCell onClick={onClick} title="Clear history" />
        <ListCell title="Language" trailing="English" />
        <ListCell href="https://example.org/a" title="Source" />
      </ListGroup>,
    );
    const section = screen.getByRole("region", { name: "Routes" });
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    const link = within(items[0]!).getByRole("link");
    expect(link.getAttribute("href")).toBe("/app/routes/R1");
    expect(link.querySelector(".pn-cell__chevron")).not.toBeNull();
    fireEvent.click(within(items[1]!).getByRole("button", { name: "Clear history" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(items[2]!.querySelector("a, button")).toBeNull();
    expect(items[2]!.querySelector(".pn-cell__chevron")).toBeNull();
    expect(items[2]!.textContent).toContain("English");
    const external = within(items[3]!).getByRole("link");
    expect(external.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("Note", () => {
  it("plain is a footnote paragraph (no role, no box); warning is a role=note box", () => {
    const { rerender } = render(<Note testId="n">Nothing saved on this phone yet.</Note>);
    const plain = screen.getByTestId("n");
    expect(plain.tagName).toBe("P");
    expect(plain.className).toBe("pn-note-plain");
    expect(plain.getAttribute("role")).toBeNull();
    rerender(
      <Note testId="n" tone="warning">
        Partial data.
      </Note>,
    );
    expect(screen.getByRole("note").textContent).toContain("Partial data.");
  });
});

describe("activeTab", () => {
  it.each([
    ["/app", "/app"],
    ["/app/explore", "/app/explore"],
    ["/app/saved", "/app/saved"],
    ["/app/more", "/app/more"],
    ["/app/explore/anything", "/app/explore"],
    ["/app/stops/x", null],
    ["/app/savedx", null],
    [null, null],
  ])("%s → %s", (path, tab) => {
    expect(activeTab(path)).toBe(tab);
  });
});

describe("ConfirmDialog", () => {
  beforeAll(() => {
    // jsdom has no showModal / close; the attribute is what the component and tests observe.
    const proto = HTMLDialogElement.prototype as unknown as { showModal: () => void; close: () => void };
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  });

  function Harness({ onConfirm, onWindowEscape }: { onConfirm: () => void; onWindowEscape: () => void }) {
    const [open, setOpen] = useState(false);
    window.onkeydown = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) onWindowEscape();
    };
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Delete trip
        </button>
        <ConfirmDialog
          open={open}
          title="Delete this trip?"
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
          testId="dialog"
        >
          It is removed from this phone.
        </ConfirmDialog>
      </>
    );
  }

  it("opens modal with focus on Cancel; Escape cancels without reaching the page, focus returns", () => {
    const onConfirm = vi.fn();
    const onWindowEscape = vi.fn();
    render(<Harness onConfirm={onConfirm} onWindowEscape={onWindowEscape} />);
    const opener = screen.getByRole("button", { name: "Delete trip" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByTestId("dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("Delete this trip?");
    expect(document.activeElement?.textContent).toBe("Cancel");

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(onWindowEscape).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute("open")).toBe(false);
  });
});

describe("OsmAttribution", () => {
  it("credits OpenStreetMap contributors under the ODbL with a safe link to the copyright page", () => {
    render(<OsmAttribution testId="osm" />);
    const note = screen.getByTestId("osm");
    expect(note.textContent).toBe("© OpenStreetMap contributors (ODbL)");
    const link = within(note).getByRole("link", { name: "© OpenStreetMap contributors (ODbL)" });
    expect(link.getAttribute("href")).toBe("https://www.openstreetmap.org/copyright");
    expect(OSM_COPYRIGHT_URL).toBe("https://www.openstreetmap.org/copyright");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
