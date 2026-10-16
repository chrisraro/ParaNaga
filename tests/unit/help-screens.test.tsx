// @vitest-environment jsdom
// Facts: new test file for Task 11 (Help, articles, sources register, MyNaga handoff) and the ride
// step's "Report it in MyNaga" link, which must mark the navigation as started from the home
// screen (frame.markHomeNavigation) so closing MyNaga returns to the running guidance.
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSession, reduceSession } from "@/domain/guidance/session";
import { guidanceView } from "@/domain/guidance/view";
import { MYNAGA_LINKS } from "@/domain/mynaga/links";
import { TRAFFIC_ROW, basisRows } from "@/domain/eta/basis";
import SOURCES from "../e2e/fixtures/network/sources.json" with { type: "json" };
import { ETA_MODEL } from "./eta-fixtures";
import { oneRide, tripOf } from "./guidance-fixtures";

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/help",
}));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a> }));

const { AppFrameContext } = await import("@/ui/app-shell/app-frame-context");
const { BADGE_MEANINGS, DATA_FOOTER, HelpScreen, INDEPENDENT_NOTE, SAFETY_TIPS } = await import("@/ui/help/help-screen");
const { HelpArticleScreen, NO_TIME_MODEL } = await import("@/ui/help/help-article");
const { MAP_OWNER_NOTE, SourcesScreen } = await import("@/ui/help/sources-screen");
const { LATER_NOTE, MYNAGA_FOOTER, MyNagaScreen, PREPARE_ITEMS } = await import("@/ui/mynaga/mynaga-screen");
const { RideStep } = await import("@/ui/guidance/ride-step");
const { resetSnapshotForTests } = await import("@/client/network/use-snapshot");

const HEAD = { revisionId: "67e56657-7542-462e-b57c-eb14439a0c7a", label: "osm-places-2026-10-15", kind: "provisional", publishedAt: "2026-10-15T12:59:57.089Z" };

let fetched: string[] = [];
let snapshotBody: unknown = null;
beforeEach(() => {
  nav.params = new URLSearchParams();
  fetched = [];
  resetSnapshotForTests();
  snapshotBody = { revision: HEAD, stops: [], variants: [], fareRules: [], terminals: [], routes: [], etaModel: ETA_MODEL };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url);
      const body = url.includes("/sources") ? SOURCES : url.includes("/network/snapshot/") ? snapshotBody : HEAD;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Help", () => {
  it("opens on Help with the three articles, the MyNaga link and the independence note", () => {
    render(<HelpScreen />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Help", "Safety", "About data"]);
    const links = within(screen.getByTestId("help-links")).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["How trips are planned", "/app/help/how-trips-are-planned"],
      ["Why stops are not verified yet", "/app/help/why-stops-are-not-verified"],
      ["Using ParaNaga offline", "/app/help/using-paranaga-offline"],
      ["How times are estimated", "/app/help/how-times-are-estimated"],
      ["Vehicle types in Naga", "/app/help/vehicle-types-in-naga"],
      ["Report a problem with a driver", "/app/mynaga"],
    ]);
    expect(screen.getByTestId("help-independent").textContent).toBe(INDEPENDENT_NOTE);
    expect(screen.getByRole("tabpanel").getAttribute("tabindex")).toBe("0");
  });

  it("Safety: 911, the tips and the MyNaga button; the tab is kept in the URL", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    render(<HelpScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Safety" }));
    expect(replace).toHaveBeenLastCalledWith(window.history.state, "", "/app/help?tab=safety");
    expect(screen.getByTestId("help-emergency").textContent).toBe("In an emergency, call 911. ParaNaga does not monitor reports and cannot send help.");
    expect(within(screen.getByTestId("help-tips")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([...SAFETY_TIPS]);
    const report = screen.getByTestId("help-report-driver");
    expect(report.textContent).toBe("Report a driver to the City in MyNaga");
    expect(report.getAttribute("href")).toBe("/app/mynaga");
  });

  it("About data: badge meanings, the data revision, sources link and footer", async () => {
    nav.params = new URLSearchParams("tab=data");
    render(<HelpScreen />);
    const rows = within(screen.getByTestId("help-badges")).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      `Verified${BADGE_MEANINGS[0]!.text}`,
      `Mapped candidate${BADGE_MEANINGS[1]!.text}`,
      `Documented only${BADGE_MEANINGS[2]!.text}`,
      `Unverified route — confirm with the driver${BADGE_MEANINGS[3]!.text}`,
      `Approximate path${BADGE_MEANINGS[4]!.text}`,
    ]);
    expect(screen.getByTestId("help-sources-link").getAttribute("href")).toBe("/app/help/sources");
    expect(screen.getByTestId("help-data-footer").textContent).toBe(DATA_FOOTER);
    await waitFor(() => expect(screen.getByTestId("help-data-revision").textContent).toBe("Data revisionosm-places-2026-10-15 · Oct 15, 2026"));
  });
});

describe("Help articles", () => {
  it("How trips are planned: exact copy, no network request", () => {
    render(<HelpArticleScreen slug="how-trips-are-planned" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("How trips are planned");
    expect(screen.getByTestId("help-article-body").textContent).toBe(
      "ParaNaga suggests trips on Loops A and B only. Their stop order comes from the order of pins on a public map, not from a field survey, so every suggestion carries the badge “Unverified route — confirm with the driver”." +
        "Ride distances follow approximate paths traced along OpenStreetMap roads between candidate pins, or straight-line distances where roads are unmapped." +
        "Walks to and from a stop are capped at 600 m, and 400 m between rides. Walk paths are routed along walkable streets where mapped, or straight-line estimates (× 1.3)." +
        "A ride is only suggested if it saves walking: taking a jeepney must replace meaningful walking distance compared to walking all the way." +
        "Times are estimated as ranges based on typical travel speeds in Naga (slower during peak hours). Times do not include waiting, because jeepneys have no published schedules." +
        "Fares are estimates from reported fare rules; the official matrix is not verified and discounts are not applied.",
    );
    expect(fetched).toEqual([]);
    expect(document.title).toBe("How trips are planned · ParaNaga");
  });

  it("Using ParaNaga offline names the published date of the data, never a placeholder", async () => {
    render(<HelpArticleScreen slug="using-paranaga-offline" />);
    // Until the date is known, the dated paragraph is not rendered (nothing like "…" is read).
    expect(screen.getByTestId("help-article-body").textContent).not.toContain("Planning offline");
    expect(screen.getByTestId("help-article-body").textContent).not.toContain("…");
    await waitFor(() => expect(screen.getByTestId("help-article-body").textContent).toContain("Planning offline uses the data from Oct 15, 2026; fares may have changed."));
  });

  it("How times are estimated: the lead, then every basis row and A1–A3 from the time model on this phone", async () => {
    render(<HelpArticleScreen slug="how-times-are-estimated" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("How times are estimated");
    const body = () => screen.getByTestId("help-article-body").textContent ?? "";
    expect(body()).toContain("Times are ranges. They do not include waiting, because Naga has no published jeepney schedules.");
    await waitFor(() => expect(body()).toContain("Tolentino & Sigua 2022, N28"));
    for (const row of basisRows(ETA_MODEL)) expect(body()).toContain(row.text);
    for (const code of ["N28", "N16", "N29", "N04"]) expect(body()).toContain(code);
    for (const a of ["Assumption A1:", "Assumption A2:", "Assumption A3:"]) expect(body()).toContain(a);
    expect(body()).toContain(TRAFFIC_ROW);
    expect(body()).not.toMatch(/live/i);
    expect(document.title).toBe("How times are estimated · ParaNaga");
  });

  it("How times are estimated: an older snapshot without a time model says so instead of guessing", async () => {
    snapshotBody = { revision: HEAD, stops: [], variants: [], fareRules: [], terminals: [], routes: [] };
    render(<HelpArticleScreen slug="how-times-are-estimated" />);
    await waitFor(() => expect(screen.getByTestId("help-article-body").textContent).toContain(NO_TIME_MODEL));
    expect(screen.getByTestId("help-article-body").textContent).not.toMatch(/km\/h/);
  });

  it("Vehicle types in Naga: one section per class, owner-confirmed modern units on R4/R7, no e-jeepney, no network request", () => {
    render(<HelpArticleScreen slug="vehicle-types-in-naga" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Vehicle types in Naga");
    const body = screen.getByTestId("help-article-body").textContent ?? "";
    expect(body).toContain("Traditional jeepney: ₱14 first 4 km + ₱2.00/km");
    expect(body).toContain("Air-conditioned modern jeepneys run on R4 (Centro–Del Rosario via Panganiban) and R7 (Centro–Carolina–Panicuason)");
    expect(body).toContain("Tricycle and e-tricycle");
    expect(body).toContain("UV Express and bus");
    // User decisions 2026-10-16: no e-jeepney anywhere; modern units operating now (no 2023–2024 caveat); nothing unsourced.
    expect(body).not.toMatch(/e-?jeep|electric jeep/i);
    expect(body).not.toMatch(/2023|last reported|Euro-?4/i);
    expect(body).not.toMatch(/live/i);
    expect(fetched).toEqual([]);
    expect(document.title).toBe("Vehicle types in Naga · ParaNaga");
  });
});

describe("Sources register", () => {
  it("lists every source with its dates and an external link, and the map owner note", async () => {
    render(<SourcesScreen />);
    await waitFor(() => expect(screen.getAllByTestId("source-row")).toHaveLength(SOURCES.sources.length));
    const s01 = screen.getAllByTestId("source-row").find((r) => r.dataset.code === "S01")!;
    expect(s01.textContent).toContain("S01 · Naga approved LPTRP, Ordinance 2025-070");
    expect(s01.textContent).toContain("Official · published 23 Sep 2025 · checked 15 Oct 2026");
    const link = within(s01).getByRole("link", { name: "Open source S01 (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://www2.naga.gov.ph/sp_ordinances/ordinance-no-2025-070/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByTestId("sources-owner-note").textContent).toBe(MAP_OWNER_NOTE);
  });

  it("credits Google Places as third-party, unverified suggestions with an unresolved rights note", () => {
    render(<SourcesScreen />);
    const google = screen.getByTestId("google-places-credits").textContent ?? "";
    expect(google).toContain("Suggestions from Google Maps");
    expect(google).toContain("third-party");
    expect(google).toContain("not verified");
    expect(google).toContain("unresolved");
    expect(google).toContain("300");
    expect(google).toContain("Google receives what you typed");
    expect(google).toContain("up to 24 hours under a one-way hash");
    expect(google).toContain("no typed text and no IP address");
    expect(google).not.toMatch(/does not store|never stores/);
  });
});

describe("MyNaga handoff", () => {
  it("shows the note, the checklist, the four verified links (store for this phone first) and the footer", () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    render(<MyNagaScreen />);
    expect(screen.getByTestId("mynaga-independent").textContent).toBe(
      "ParaNaga is independent. It is not affiliated with MyNaga or the City Government and is not an official channel. Opening MyNaga does not submit your report.",
    );
    expect(within(screen.getByTestId("mynaga-prepare")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([...PREPARE_ITEMS]);
    const links = within(screen.getByTestId("mynaga-links")).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Get MyNaga on the App Store", "Get MyNaga on Google Play", "Open mynaga.app", "About MyNaga (City of Naga)"]);
    for (const l of links) {
      expect(MYNAGA_LINKS.map((m) => m.url)).toContain(l.getAttribute("href"));
      expect(l.getAttribute("target")).toBe("_blank");
      expect(l.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(screen.getByTestId("mynaga-later").textContent).toBe(LATER_NOTE);
    // Steps 1 and 2 are numbered; "After you submit in MyNaga" is not a step to take.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "1Prepare what you will share",
      "2Open MyNaga and submit there",
      "After you submit in MyNaga",
    ]);
    expect(screen.getByTestId("mynaga-footer").textContent).toBe(MYNAGA_FOOTER);
    // Nothing is copied, prepared or sent: no buttons, no inputs, no request.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(fetched).toEqual([]);
    ua.mockRestore();
  });
});

describe("Ride step → MyNaga", () => {
  it("marks the MyNaga navigation as started from the home screen", () => {
    const T0 = 1_000_000;
    let s = startSession(tripOf(oneRide()), T0);
    s = reduceSession(s, { type: "atStop" });
    s = reduceSession(s, { type: "boarded" });
    const view = guidanceView(s, null, T0);
    if (view.screen !== "ride") throw new Error(`expected the ride step, got ${view.screen}`);
    const markHomeNavigation = vi.fn();
    const frame = { markHomeNavigation } as unknown as React.ContextType<typeof AppFrameContext>;
    render(
      <AppFrameContext.Provider value={frame}>
        <RideStep view={view} onSend={vi.fn()} location={{ state: "idle", watching: false, onEnable: vi.fn() }} headingRef={{ current: null }} alertKey="k" />
      </AppFrameContext.Provider>,
    );
    const link = screen.getByTestId("guidance-report-driver");
    expect(link.getAttribute("href")).toBe("/app/mynaga");
    fireEvent.click(link);
    expect(markHomeNavigation).toHaveBeenCalledWith("/app/mynaga");
  });
});
