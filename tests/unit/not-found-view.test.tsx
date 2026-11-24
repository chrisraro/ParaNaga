// @vitest-environment jsdom
// The root 404 follows the UI language (audit F9) and puts the translated title in the tab.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { fil } from "@/i18n/fil";

const dict = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/i18n/provider", () => ({ useT: () => dict.current, useLocale: () => "en" }));

const { NotFoundView } = await import("@/app/not-found-view");

afterEach(cleanup);

describe("root 404", () => {
  it("English keeps its words", () => {
    dict.current = en;
    render(<NotFoundView />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Wrong stop.");
    expect(screen.getByRole("link", { name: "Open the map" }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("link", { name: "Lunad home" }).getAttribute("href")).toBe("/");
    expect(document.title).toBe("Page not found · Lunad");
  });

  it("Filipino has no English words and a Filipino tab title", () => {
    dict.current = fil;
    render(<NotFoundView />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(fil.detail.lostTitle);
    expect(screen.getByRole("link", { name: fil.detail.lostOpenMap }).getAttribute("href")).toBe("/app");
    expect(screen.queryByText("Open the map")).toBeNull();
    expect(document.title).toBe(`${fil.detail.lostTabTitle} · Lunad`);
  });
});
