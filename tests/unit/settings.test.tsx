// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, PREFS_STORAGE_KEY } from "@/domain/prefs/prefs";

const history = vi.hoisted(() => ({ exists: false, cleared: 0 }));
vi.mock("@/client/history/trip-history", () => ({
  hasHistory: async () => history.exists,
  clearHistory: async () => {
    history.cleared += 1;
    history.exists = false;
  },
}));

const { clearDeviceData } = await import("@/client/device-data");
const { readPrefs, updatePrefs, usePrefs } = await import("@/client/prefs/use-prefs");
const { CLEAR_DATA_QUESTION, DELETE_HISTORY_QUESTION, MoreScreen, revisionLine } = await import("@/ui/settings/more-screen");

const HEAD = { revisionId: "703dc1be-879e-43be-91cb-d9a472b56dd1", label: "provisional-loops-2026-10-15", kind: "provisional", publishedAt: "2026-10-15T08:55:12.774Z" };

beforeEach(() => {
  history.exists = false;
  history.cleared = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(HEAD), { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-contrast");
});

const stored = () => JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) ?? "null");

describe("prefs store", () => {
  it("reads defaults from bad data and writes merged, validated preferences", () => {
    localStorage.setItem(PREFS_STORAGE_KEY, "{oops");
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    updatePrefs({ theme: "dark" });
    expect(stored()).toEqual({ ...DEFAULT_PREFS, theme: "dark" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    updatePrefs({ highContrast: true });
    expect(stored()).toEqual({ ...DEFAULT_PREFS, theme: "dark", highContrast: true });
    expect(document.documentElement.getAttribute("data-contrast")).toBe("more");
  });

  it("follows a change made in another tab (storage event)", () => {
    function Probe() {
      return <p data-testid="probe">{usePrefs().theme}</p>;
    }
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("system");
    act(() => {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ theme: "light" }));
      window.dispatchEvent(new StorageEvent("storage", { key: PREFS_STORAGE_KEY }));
    });
    expect(screen.getByTestId("probe").textContent).toBe("light");
  });
});

describe("clearDeviceData", () => {
  it("removes ParaNaga's storage keys, resets the settings and leaves other sites' keys", async () => {
    updatePrefs({ theme: "dark", highContrast: true, lowData: true });
    localStorage.setItem("paranaga.other", "x");
    localStorage.setItem("someone-else", "keep");
    sessionStorage.setItem("paranaga.guidance", "{}");
    sessionStorage.setItem("someone-else", "keep");

    await clearDeviceData();

    expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("paranaga.other")).toBeNull();
    expect(sessionStorage.getItem("paranaga.guidance")).toBeNull();
    expect(localStorage.getItem("someone-else")).toBe("keep");
    expect(sessionStorage.getItem("someone-else")).toBe("keep");
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    expect(history.cleared).toBe(1);
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    expect(document.documentElement.hasAttribute("data-contrast")).toBe(false);
  });
});

describe("More screen", () => {
  it("shows the exact copy and the data revision", async () => {
    render(<MoreScreen />);
    expect(screen.getByText("Accounts arrive later")).toBeTruthy();
    expect(screen.getByText("Everything works without one. Saved trips and places stay on this phone.")).toBeTruthy();
    expect(screen.getByText("Filipino arrives after a reviewed translation.")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Low-data mode" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "High contrast" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Trip history" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Help")).toBeNull(); // arrives with Task 11
    await waitFor(() => expect(screen.getByTestId("settings-data-revision").textContent).toContain("provisional-loops-2026-10-15 · Oct 15, 2026"));
    expect(screen.getByTestId("settings-location-status").textContent).toBe("Not available");
  });

  it("formats the revision line in Naga City time and says when the date is unknown", () => {
    expect(revisionLine({ ...HEAD, kind: "provisional", publishedAt: "2026-10-15T17:00:00.000Z" })).toBe("provisional-loops-2026-10-15 · Oct 16, 2026");
    expect(revisionLine({ ...HEAD, kind: "provisional", publishedAt: null })).toBe("provisional-loops-2026-10-15 · publication date not recorded");
  });

  it("Appearance and the switches update the preferences", () => {
    render(<MoreScreen />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(stored().theme).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Low-data mode" }));
    expect(stored().lowData).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "High contrast" }));
    expect(document.documentElement.getAttribute("data-contrast")).toBe("more");
  });

  it("turning Trip history off asks nothing while there is no history", async () => {
    updatePrefs({ historyEnabled: true });
    render(<MoreScreen />);
    fireEvent.click(screen.getByRole("switch", { name: "Trip history" }));
    expect(stored().historyEnabled).toBe(false);
    await act(async () => {});
    expect(screen.getByTestId("settings-history-dialog").hasAttribute("open")).toBe(false);
  });

  it("turning Trip history off with history asks to delete it: Keep keeps it, Delete deletes it", async () => {
    updatePrefs({ historyEnabled: true });
    history.exists = true;
    render(<MoreScreen />);
    const toggle = screen.getByRole("switch", { name: "Trip history" });

    fireEvent.click(toggle);
    expect(stored().historyEnabled).toBe(false);
    const dialog = await screen.findByTestId("settings-history-dialog");
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(true));
    expect(dialog.textContent).toContain(DELETE_HISTORY_QUESTION);
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(history.cleared).toBe(0);

    fireEvent.click(toggle); // on again
    expect(stored().historyEnabled).toBe(true);
    fireEvent.click(toggle); // off: asked again
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(history.cleared).toBe(1));
    await waitFor(() => expect(screen.getByTestId("settings-status").textContent).toBe("Trip history on this phone deleted."));
  });

  it("Clear data on this device asks first, then clears", async () => {
    updatePrefs({ theme: "dark", lowData: true });
    render(<MoreScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Clear data on this device" }));
    const dialog = screen.getByTestId("settings-clear-dialog");
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(true));
    expect(dialog.textContent).toContain(CLEAR_DATA_QUESTION);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(stored().theme).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: "Clear data on this device" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(localStorage.getItem(PREFS_STORAGE_KEY)).toBeNull());
    await waitFor(() => expect(screen.getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByRole("switch", { name: "Low-data mode" }).getAttribute("aria-checked")).toBe("false");
  });
});
