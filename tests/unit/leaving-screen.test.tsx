// @vitest-environment jsdom
// S24 Leaving Naga (src/ui/intercity/leaving-screen.tsx) over the synthetic intercity guide built
// from the draft seed (tests/e2e/fixtures/network/intercity.json), with a mocked router, a stub
// app frame and a mocked clock (Manila dates). Covers the IC1 acceptance lines the screen owns:
// Legazpi's suspended PNR, no "Get to" for T02 / T17, every fare with a basis and month, staleness
// past review_by, the RS06 correction, the South Long Haul as "no trains run" only, the "not found"
// lines, the copy rules (in English and Filipino), and the entry points (Explore, terminal detail,
// Help is in help-screens.test.tsx, Sources ?service=, the hook).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { intercitySchema, searchIndexSchema, terminalDetailSchema, type Intercity } from "@/domain/api/schemas";
import { en } from "@/i18n/en";
import { fil } from "@/i18n/fil";
import rawIntercity from "../e2e/fixtures/network/intercity.json" with { type: "json" };
import rawHead from "../e2e/fixtures/network/stops-all.json" with { type: "json" };
import rawIndex from "../e2e/fixtures/network/search-index.json" with { type: "json" };
import rawSources from "../e2e/fixtures/network/sources.json" with { type: "json" };
import rawT01 from "../e2e/fixtures/network/terminal-t01.json" with { type: "json" };

const nav = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn(), params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: nav.back, push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/leaving",
  useSearchParams: () => nav.params,
}));
// Leaflet needs a real layout engine (terminal detail draws a map).
vi.mock("@/ui/map/naga-map", () => ({ NagaMap: () => <div data-testid="naga-map-stub" /> }));
const lang = vi.hoisted(() => ({ fil: false }));
vi.mock("@/i18n/provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/i18n/provider")>();
  const { fil: filDict } = await import("@/i18n/fil");
  const { en: enDict } = await import("@/i18n/en");
  return { ...real, useT: () => (lang.fil ? filDict : enDict) };
});

const { AppFrameContext, setEntryPath } = await import("@/ui/app-shell/app-frame-context");
const { LeavingScreen, LeavingView, CARD_SUMMARY_WORDS } = await import("@/ui/intercity/leaving-screen");
const { resetIntercityForTests } = await import("@/client/network/use-intercity");
const { ExploreView } = await import("@/ui/explore/explore-screen");
const { TerminalDetailView } = await import("@/ui/terminals/terminal-detail");
const { SourcesScreen } = await import("@/ui/help/sources-screen");

const data: Intercity = intercitySchema.parse(rawIntercity);
const REV = data.revision.revisionId;

const frame = {
  openPanel: () => () => {},
  markHomeNavigation: () => {},
  isHomeNavigation: () => false,
  mapFocus: null,
  showOnMap: () => {},
  hideTabBar: () => () => {},
  tabBarVisible: false,
  tabBarClearance: 0,
  panelOpen: true,
  endpointRequest: null,
  requestEndpoint: vi.fn(),
  requestPick: vi.fn(),
  requestGps: vi.fn(),
  tripRequest: null,
  requestTrip: vi.fn(),
};

/** 12:00 in Manila on `day`. */
const atManila = (day: string) => vi.setSystemTime(new Date(`${day}T04:00:00Z`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  atManila("2026-10-28");
  lang.fil = false;
  nav.params = new URLSearchParams();
  setEntryPath("/app");
  window.history.replaceState(null, "", "/app/leaving");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setEntryPath(null);
  resetIntercityForTests();
});

function renderView(to: string | null, guide: Intercity = data) {
  return render(
    <AppFrameContext.Provider value={frame}>
      <LeavingView data={guide} to={to} />
    </AppFrameContext.Provider>,
  );
}

const card = (code: string) => screen.getAllByTestId("leaving-card").find((c) => c.getAttribute("data-code") === code)!;
const cardIn = (section: string, code: string) =>
  within(screen.getByTestId(section)).getAllByTestId("leaving-card").find((c) => c.getAttribute("data-code") === code);
const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** Visible text: a closed <details> shows only its summary. */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const d of clone.querySelectorAll("details:not([open])")) for (const child of [...d.children]) if (child.tagName !== "SUMMARY") child.remove();
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}
const MONTH = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/;

describe("Legazpi (AC-IC2, AC-IC1)", () => {
  it("lists PNR under Not running as suspended since 10 Nov 2025, with no fare, no departures and no Get to", () => {
    renderView("D-LEGAZPI");
    expect(screen.getByRole("heading", { level: 1, name: "Legazpi" })).toBe(document.activeElement);
    expect(cardIn("leaving-running", "RS09")).toBeUndefined();
    const pnr = cardIn("leaving-not-running", "RS09")!;
    expect(pnr).toBeDefined();
    expect(within(screen.getByTestId("leaving-not-running")).getByRole("heading", { level: 2, name: "Not running" })).toBeTruthy();
    expect(within(pnr).getByTestId("leaving-status").textContent).toContain("Suspended since 10 Nov 2025 · bridge damage · no reopening date");
    expect(within(pnr).queryByTestId("leaving-fares")).toBeNull();
    expect(within(pnr).queryByTestId("leaving-departures")).toBeNull();
    expect(within(pnr).queryByTestId("leaving-estimate")).toBeNull();
    expect(pnr.textContent).not.toMatch(/₱/);
    expect(within(pnr).queryByRole("button")).toBeNull();
  });

  it("puts the running BCS buses first, with Get to Bicol Central Station setting the destination", () => {
    renderView("D-LEGAZPI");
    const running = within(screen.getByTestId("leaving-running")).getAllByTestId("leaving-card").map((c) => c.getAttribute("data-code"));
    expect(running).toEqual(["RS10", "RS21"]); // operating before unconfirmed (sortServices)
    const bcs = card("RS10");
    expect(within(bcs).getByTestId("leaving-departure").textContent).toBe("Dispatch every 15 min · terminal rule, Apr 2024");
    fireEvent.click(within(bcs).getByRole("button", { name: "Get to Bicol Central Station" }));
    expect(frame.requestEndpoint).toHaveBeenCalledWith("destination", { point: { lat: 13.6192359, lng: 123.1897426 }, label: "Bicol Central Station (map point, entrance not mapped)" });
    expect(nav.push).toHaveBeenCalledWith("/app");
  });

  it("keeps the rule estimate apart from the fares seen, closed by default", () => {
    renderView("D-LEGAZPI");
    const bcs = card("RS10");
    const estimate = within(bcs).getByTestId("leaving-estimate");
    expect(estimate.tagName).toBe("DETAILS");
    expect(estimate.hasAttribute("open")).toBe(false);
    expect(estimate.textContent).toContain("Estimate from national rates");
    expect(estimate.textContent).toContain("operator prices may differ");
    expect(within(bcs).getByTestId("leaving-fares").contains(estimate)).toBe(false);
    expect(within(bcs).getByTestId("leaving-fare-not-found").textContent).toBe("Fare not found. Ask at the terminal before you board.");
  });
});

describe("no Get to without an in-city coordinate (AC-IC1)", () => {
  it("T02 (Eastbound vans) shows the address and Location being confirmed", () => {
    renderView("D-LEGAZPI");
    const vans = card("RS21");
    expect(within(vans).queryByRole("button", { name: /^Get to/ })).toBeNull();
    expect(within(vans).getByTestId("leaving-no-get-to").textContent).toBe("From Eastbound Terminal · Location being confirmed");
    expect(within(vans).getByTestId("leaving-address-text").textContent).toBe("Anciano Street / Naga City Subdivision area");
  });

  it("T17 (Naga Airport, Pili) has no Get to; the access note and 'fare not found' show", () => {
    renderView("D-CLARK");
    const flight = card("RS24");
    expect(within(flight).queryByRole("button", { name: /^Get to/ })).toBeNull();
    expect(within(flight).getByTestId("leaving-no-get-to").textContent).toBe("From Naga Airport (WNP) · Location being confirmed");
    expect(within(flight).getByTestId("leaving-access-text").textContent).toContain("400 m walk from Maharlika Highway");
    expect(within(flight).getByTestId("leaving-departure").textContent).toBe("1 trip a day · news report, Mar 2026");
    expect(within(flight).getByTestId("leaving-fare-not-found")).toBeTruthy();
    expect(within(flight).queryByTestId("leaving-estimate")).toBeNull();
  });

  it("no destination page offers Get to for T02 or T17, and every Get to names an in-city terminal", () => {
    for (const d of data.destinations) {
      const { unmount } = renderView(d.code);
      for (const c of screen.queryAllByTestId("leaving-card")) {
        const svc = data.services.find((s) => s.code === c.getAttribute("data-code"))!;
        const button = within(c).queryByTestId("leaving-get-to");
        if (svc.terminal?.code === "T02" || svc.terminal?.code === "T17") expect(button, `${d.code} ${svc.code}`).toBeNull();
        if (button) expect(svc.terminal?.lat, `${d.code} ${svc.code}`).not.toBeNull();
      }
      unmount();
    }
  });
});

describe("fares (AC-IC4)", () => {
  it("every fare shown carries its basis and its month; nothing says cheapest; amounts are never summed", () => {
    let seen = 0;
    for (const d of data.destinations) {
      const { container, unmount } = renderView(d.code);
      for (const line of screen.queryAllByTestId("leaving-fare")) {
        seen += 1;
        const text = line.textContent ?? "";
        expect(text, d.code).toMatch(MONTH);
        expect(text, d.code).toMatch(/published fare|listed on a booking site|listing from|at launch/);
        expect(text.match(/₱/g)?.length ?? 0, text).toBeLessThanOrEqual(2); // one amount, or one range
      }
      expect(container.textContent).not.toMatch(/cheapest|total/i);
      unmount();
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("Cubao shows the booking-site listings with their month, and the at-launch PNR range elsewhere", () => {
    renderView("D-CUBAO");
    const fares = within(card("RS16")).getAllByTestId("leaving-fare").map((f) => f.textContent);
    expect(fares).toEqual([
      "₱1,112 Regular · listed on a booking site, Sep 2026 · not verified",
      "₱1,230 Seater 41 · listed on a booking site, Sep 2026 · not verified",
    ]);
    cleanup();
    renderView("D-LIBMANAN");
    expect(within(card("RS08")).getAllByTestId("leaving-fare").map((f) => f.textContent)).toEqual([
      "₱12–₱60 Senior/PWD at launch (Nov 2025) · current fares not confirmed",
      "₱15–₱75 at launch (Nov 2025) · current fares not confirmed",
    ]);
  });

  it("a travel-guide listing reads as old", () => {
    renderView("D-DAET");
    expect(within(card("RS22")).getByTestId("leaving-fare").textContent).toBe("₱140 (listing from Oct 2023) · likely changed");
    expect(within(card("RS22")).getByTestId("leaving-chips").textContent).toContain("Old");
  });
});

describe("staleness on the phone's Manila date (AC-IC5)", () => {
  it("before review_by: the listing shows and nothing is marked out of date", () => {
    renderView("D-CUBAO");
    expect(screen.queryByTestId("leaving-stale-banner")).toBeNull();
    expect(within(card("RS16")).getByTestId("leaving-status").textContent).toBe("Not confirmed as of 28 Oct 2026");
  });

  it("past review_by: booking-site amounts are hidden and 'may be out of date' shows", () => {
    atManila("2027-03-01"); // RS16 review_by 2027-02-25
    renderView("D-CUBAO");
    const dltb = card("RS16");
    expect(within(dltb).getByTestId("leaving-status").getAttribute("data-stale")).toBe("true");
    expect(within(dltb).getByTestId("leaving-status").textContent).toContain("May be out of date · as of 28 Oct 2026");
    expect(within(dltb).queryAllByTestId("leaving-fare")).toEqual([]);
    expect(dltb.textContent).not.toContain("₱1,112");
    expect(within(dltb).getByTestId("leaving-fares-hidden").textContent).toBe("Prices listed on booking sites are hidden: they may be out of date. Ask at the terminal.");
    expect(screen.getByTestId("leaving-stale-banner").textContent).toContain("may be out of date");
  });

  it("booking-site departure times follow the same rule: hidden past review_by, with the out-of-date line", () => {
    renderView("D-CUBAO");
    expect(within(card("RS16")).getByTestId("leaving-departure").textContent).toBe("Listed times 20:00, 20:45 · booking site, not verified, Sep 2026");
    expect(within(card("RS17")).getByTestId("leaving-departure").textContent).toContain("Departures 08:00–22:00");
    cleanup();
    atManila("2027-03-01");
    renderView("D-CUBAO");
    for (const code of ["RS16", "RS17"]) {
      const c = card(code);
      expect(within(c).queryAllByTestId("leaving-departure"), code).toEqual([]);
      expect(c.textContent).not.toMatch(/20:00|08:00–22:00/);
      expect(within(c).getByTestId("leaving-departures-hidden").textContent).toBe("Times listed on booking sites are hidden: they may be out of date. Ask at the terminal.");
    }
  });

  it("booking-site departure times older than 120 days are hidden even before review_by", () => {
    atManila("2027-01-30"); // RS16 listing observed Sep 2026: 1 Sep + 120 days = 30 Dec 2026; review_by 25 Feb 2027
    renderView("D-CUBAO");
    expect(within(card("RS16")).getByTestId("leaving-status").getAttribute("data-stale")).toBeNull();
    expect(within(card("RS16")).queryAllByTestId("leaving-departure")).toEqual([]);
    expect(within(card("RS16")).getByTestId("leaving-departures-hidden")).toBeTruthy();
    // Other bases stay: the BCS terminal rule on Legazpi.
    cleanup();
    renderView("D-LEGAZPI");
    expect(within(card("RS10")).getByTestId("leaving-departure").textContent).toContain("terminal rule");
  });

  it("turns at Manila midnight, not UTC midnight", () => {
    vi.setSystemTime(new Date("2027-02-25T15:59:00Z")); // 23:59 on 25 Feb in Manila
    renderView("D-CUBAO");
    expect(within(card("RS16")).getByTestId("leaving-status").getAttribute("data-stale")).toBeNull();
    cleanup();
    vi.setSystemTime(new Date("2027-02-25T16:00:00Z")); // 00:00 on 26 Feb in Manila
    renderView("D-CUBAO");
    expect(within(card("RS16")).getByTestId("leaving-status").getAttribute("data-stale")).toBe("true");
  });
});

describe("RS06 Philtranco (AC-IC6)", () => {
  it("reads Stopped service reported (Mar 2026), under Not running", () => {
    renderView("D-PITX");
    expect(cardIn("leaving-running", "RS06")).toBeUndefined();
    const philtranco = cardIn("leaving-not-running", "RS06")!;
    expect(within(philtranco).getByTestId("leaving-status").textContent).toContain("Stopped service reported (Mar 2026) · no resumption found");
    expect(philtranco.textContent).not.toMatch(/Bicol Isarog|₱/);
  });
});

describe("South Long Haul (AC-IC3)", () => {
  it("appears only in the rail card, as no trains run", () => {
    renderView(null);
    const slh = screen.getByTestId("leaving-south-long-haul");
    expect(slh.textContent).toBe("South Long Haul (Bicol Express): Planned project · not funded · no trains run");
    expect(within(screen.getByTestId("leaving-rail")).getAllByTestId("leaving-rail-row").map((r) => r.getAttribute("data-code"))).toEqual(["RS08", "RS09"]);
    expect(document.body.textContent!.match(/South Long Haul/g)).toHaveLength(1);
    cleanup();
    for (const d of data.destinations) {
      const { container, unmount } = renderView(d.code);
      expect(container.textContent, d.code).not.toMatch(/South Long Haul|Bicol Express/);
      unmount();
    }
  });

  it("is not shown when the note is not published", () => {
    renderView(null, { ...data, notes: [] });
    expect(screen.queryByTestId("leaving-south-long-haul")).toBeNull();
  });
});

describe("empty guide (IC1 not yet published)", () => {
  it("says no towns are on file, with no search box and no 'nothing matches' line", () => {
    renderView(null, { ...data, destinations: [], services: [], notes: [] });
    expect(screen.getByTestId("leaving-none-on-file").textContent).toBe("No towns outside Naga are on file yet.");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.queryByTestId("leaving-no-match")).toBeNull();
    expect(document.body.textContent).not.toContain("Nothing on file matches");
  });

  it("in Filipino too", () => {
    lang.fil = true;
    renderView(null, { ...data, destinations: [], services: [], notes: [] });
    expect(screen.getByTestId("leaving-none-on-file").textContent).toBe(fil.intercity.noneOnFile);
  });
});

describe("list view", () => {
  it("pins the rail and airport cards, then groups the destinations with a labelled search box", () => {
    renderView(null);
    expect(screen.getByRole("heading", { level: 1, name: "Leaving Naga" })).toBe(document.activeElement);
    const order = [...document.querySelectorAll("[data-testid^='leaving-']")].map((e) => e.getAttribute("data-testid"));
    expect(order.indexOf("leaving-rail")).toBeLessThan(order.indexOf("leaving-airport"));
    expect(order.indexOf("leaving-airport")).toBeLessThan(order.indexOf("leaving-destinations"));
    const airport = screen.getByTestId("leaving-airport-row");
    expect(airport.getAttribute("href")).toBe("/app/leaving?to=D-CLARK");
    expect(airport.textContent).toContain("Flights to Clark");
    expect(airport.textContent).toContain("Naga Airport (WNP) · Maharlika Hwy, San Jose, Pili");
    expect(screen.getByRole("searchbox", { name: "Find a town or hub" })).toBeTruthy();
    const albay = within(screen.getByTestId("leaving-group-albay")).getAllByTestId("leaving-destination");
    expect(albay.map((a) => [a.querySelector(".pn-cell__title")?.textContent, a.getAttribute("href")])).toEqual([
      ["Legazpi", "/app/leaving?to=D-LEGAZPI"],
      ["Tabaco", "/app/leaving?to=D-TABACO"],
    ]);
    expect(albay[0]!.textContent).toContain("UV Express, Bus from Naga");
    expect(screen.queryByRole("img")).toBeNull(); // no map on the list
  });

  it("the search box filters by name, ignoring case and accents, and says when nothing matches", () => {
    renderView(null);
    const box = screen.getByRole("searchbox", { name: "Find a town or hub" });
    fireEvent.change(box, { target: { value: "LÉGA" } });
    expect(screen.getAllByTestId("leaving-destination").map((a) => a.querySelector(".pn-cell__title")?.textContent)).toEqual(["Legazpi"]);
    fireEvent.change(box, { target: { value: "Zamboanga" } });
    expect(screen.getByTestId("leaving-no-match").textContent).toBe("Nothing on file matches “Zamboanga”.");
  });

  it("matches an alias", () => {
    const guide = { ...data, destinations: data.destinations.map((d) => (d.code === "D-PITX" ? { ...d, aliases: ["Parañaque Integrated Terminal Exchange"] } : d)) };
    renderView(null, guide);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "paranaque" } });
    expect(screen.getAllByTestId("leaving-destination").map((a) => a.querySelector(".pn-cell__title")?.textContent)).toEqual(["PITX"]);
  });

  it("an unknown or malformed ?to= says the place is not on file, with a way back", () => {
    renderView("D-NOWHERE");
    expect(screen.getByRole("heading", { level: 1, name: "Place not on file" })).toBe(document.activeElement);
    expect(screen.getByRole("link", { name: "All towns and hubs" }).getAttribute("href")).toBe("/app/leaving");
  });
});

describe("not found lines carry a next step (AC-IC8)", () => {
  it("Caramoan: departures and fare not found, each saying what to do", () => {
    renderView("D-CARAMOAN");
    const bus = card("RS13");
    expect(within(bus).getByTestId("leaving-departure").textContent).toBe("Departure times not found. Ask at the terminal.");
    expect(within(bus).getByTestId("leaving-fare-not-found").textContent).toBe("Fare not found. Ask at the terminal before you board.");
  });

  it("a destination with no running service says so", () => {
    const guide = { ...data, services: data.services.filter((s) => s.code !== "RS10" && s.code !== "RS21") };
    renderView("D-LEGAZPI", guide);
    expect(screen.getByTestId("leaving-none-running").textContent).toBe("No running service to Legazpi is on file. Ask at the terminal.");
  });

  it("every card links to its own sources", () => {
    renderView("D-CUBAO");
    const link = within(card("RS16")).getByRole("link", { name: "Sources for DLTB Naga–Manila" });
    expect(link.getAttribute("href")).toBe("/app/help/sources?service=RS16");
  });
});

describe("copy rules (design §4)", () => {
  const BANNED = /schedule|next bus|on time|\bbook\b|\bbook now\b|iskedyul|susunod na bus/i;
  for (const [name, isFil] of [["English", false], ["Filipino", true]] as const) {
    it(`${name}: no banned wording, card summaries within ${CARD_SUMMARY_WORDS} words, fact rows within 24`, () => {
      lang.fil = isFil;
      const views: (string | null)[] = [null, ...data.destinations.map((d) => d.code)];
      for (const to of views) {
        const { container, unmount } = renderView(to);
        expect(container.textContent, String(to)).not.toMatch(BANNED);
        for (const c of screen.queryAllByTestId("leaving-card")) {
          const summary = visibleText(c.querySelector("[data-card-summary]")!);
          const action = visibleText(c.querySelector(".pn-ic-card__actions")!);
          expect(words(`${summary} ${action}`), `${to} ${c.getAttribute("data-code")}: ${summary} ${action}`).toBeLessThanOrEqual(CARD_SUMMARY_WORDS);
          for (const line of c.querySelectorAll("[data-fact-line]")) expect(words(line.textContent ?? ""), line.textContent ?? "").toBeLessThanOrEqual(24);
        }
        unmount();
      }
    });
  }

  it("Filipino: the screen shows no English dictionary string", () => {
    lang.fil = true;
    renderView("D-LEGAZPI");
    const text = document.body.textContent ?? "";
    for (const key of ["running", "notRunning", "departuresLabel", "faresLabel", "estimateLabel", "footer", "locationBeingConfirmed"] as const) {
      expect(text).not.toContain(en.intercity[key]);
      expect(text).toContain(fil.intercity[key]);
    }
    expect(text).toContain("Suspendido mula 10 Nob 2025");
  });
});

describe("data hook (use-intercity) through the screen", () => {
  const ok = (body: unknown, cache = "public, s-maxage=31536000, immutable") =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "cache-control": cache } });

  it("reads the head, fetches the guide of that revision once, and renders the list", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/v1/network/head") return ok(rawHead.revision, "public, s-maxage=30");
      if (url === `/api/v1/network/intercity/${REV}`) return ok(rawIntercity);
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = render(
      <AppFrameContext.Provider value={frame}>
        <LeavingScreen />
      </AppFrameContext.Provider>,
    );
    expect(await screen.findByTestId("leaving-list")).toBeTruthy();
    unmount();
    nav.params = new URLSearchParams("to=D-LEGAZPI");
    render(
      <AppFrameContext.Provider value={frame}>
        <LeavingScreen />
      </AppFrameContext.Provider>,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Legazpi" })).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => u === "/api/v1/network/head").length).toBe(2));
    expect(fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/v1/network/intercity/"))).toHaveLength(1);
  });

  it("without a guide in memory, a failed load is an error with Try again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    render(
      <AppFrameContext.Provider value={frame}>
        <LeavingScreen />
      </AppFrameContext.Provider>,
    );
    expect(await screen.findByTestId("detail-error")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("an invalid guide is never shown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url === "/api/v1/network/head" ? ok(rawHead.revision) : ok({ ...rawIntercity, services: [{ code: "XX" }] }))),
    );
    render(
      <AppFrameContext.Provider value={frame}>
        <LeavingScreen />
      </AppFrameContext.Provider>,
    );
    expect(await screen.findByTestId("detail-error")).toBeTruthy();
  });
});

describe("entry points", () => {
  const guideFetch = (guide: unknown) =>
    vi.fn(async (url: string) => {
      const body = url === "/api/v1/network/head" ? rawHead.revision : url === `/api/v1/network/intercity/${REV}` ? guide : null;
      return body ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) : new Response("{}", { status: 404 });
    });
  const renderExplore = () =>
    render(
      <AppFrameContext.Provider value={frame}>
        <ExploreView index={searchIndexSchema.parse(rawIndex)} />
      </AppFrameContext.Provider>,
    );

  it("Explore has a Leaving Naga card once the guide lists a destination", async () => {
    vi.stubGlobal("fetch", guideFetch(rawIntercity));
    renderExplore();
    const link = within(await screen.findByTestId("explore-leaving")).getByRole("link");
    expect(link.getAttribute("href")).toBe("/app/leaving");
    expect(link.textContent).toContain("Leaving Naga");
  });

  it("Explore shows no Leaving Naga card while the guide loads, fails or is empty", async () => {
    const empty = guideFetch({ ...rawIntercity, destinations: [], services: [] });
    vi.stubGlobal("fetch", empty);
    renderExplore();
    expect(screen.queryByTestId("explore-leaving")).toBeNull(); // loading
    await waitFor(() => expect(empty.mock.calls.some(([u]) => String(u).includes("/network/intercity/"))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("explore-leaving")).toBeNull(); // empty
    cleanup();
    resetIntercityForTests();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    renderExplore();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("explore-leaving")).toBeNull(); // failed
  });

  it("terminal detail links Destinations from here only when hasIntercity", () => {
    const t01 = terminalDetailSchema.parse(rawT01);
    const { unmount } = render(
      <AppFrameContext.Provider value={frame}>
        <TerminalDetailView data={{ ...t01, hasIntercity: true }} />
      </AppFrameContext.Provider>,
    );
    expect(screen.getByRole("link", { name: "Destinations from here" }).getAttribute("href")).toBe("/app/leaving");
    unmount();
    render(
      <AppFrameContext.Provider value={frame}>
        <TerminalDetailView data={{ ...t01, hasIntercity: false }} />
      </AppFrameContext.Provider>,
    );
    expect(screen.queryByRole("link", { name: "Destinations from here" })).toBeNull();
  });

  it("Sources ?service=RS16 shows only that service's sources, with Show all", async () => {
    const ic25 = { ...rawSources.sources[0]!, code: "IC25", title: "Pamasahe, DLTB" };
    const ic27 = { ...rawSources.sources[0]!, code: "IC27", title: "bustickets.ph" };
    const register = { ...rawSources, sources: [...rawSources.sources, ic25, ic27] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body =
          url === "/api/v1/sources" ? register
          : url === "/api/v1/network/head" ? rawHead.revision
          : url === `/api/v1/network/intercity/${REV}` ? rawIntercity
          : null;
        return body ? new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }) : new Response("{}", { status: 404 });
      }),
    );
    nav.params = new URLSearchParams("service=RS16");
    render(
      <AppFrameContext.Provider value={frame}>
        <SourcesScreen />
      </AppFrameContext.Provider>,
    );
    const filtered = await screen.findByTestId("sources-service");
    expect(within(filtered).getByRole("heading", { level: 2 }).textContent).toBe("Showing sources for DLTB Naga–Manila");
    expect(within(filtered).getAllByTestId("source-row").map((r) => r.getAttribute("data-code"))).toEqual(["IC25", "IC27"]);
    expect(within(filtered).getByRole("link", { name: "Show all sources" }).getAttribute("href")).toBe("/app/help/sources");
  });
});
