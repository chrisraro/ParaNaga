// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streetViewEmbed, streetViewLink } from "@/domain/media/street-view";
import { StopStreetView } from "@/ui/street-view/stop-street-view";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const point = { lat: 13.6233869, lng: 123.1846726 };

describe("Street View reference viewer", () => {
  it("sends only the recorded point, encodes the key and rejects invalid coordinates", () => {
    const url = new URL(streetViewEmbed(point, "test&key=value")!);
    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.get("key")).toBe("test&key=value");
    expect(url.searchParams.get("location")).toBe("13.6233869,123.1846726");
    expect([...url.searchParams.keys()]).toEqual(["key", "location"]);
    expect(streetViewEmbed({ lat: NaN, lng: 123 }, "test")).toBeNull();
    expect(streetViewLink({ lat: 91, lng: 123 })).toBeNull();
  });
  it("uses place wording and a responsive iframe for a place", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY", "test-embed-key");
    render(<StopStreetView {...point} name="SM City Naga" what="place" />);
    expect(screen.getByText(/entrance and signage unverified/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View surroundings" }));
    expect(screen.getByTestId("street-view-iframe").hasAttribute("width")).toBe(false);
  });
  it("makes no iframe request until opened, and removes the viewer on close", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY", "test-embed-key");
    render(<StopStreetView {...point} name="Plaza Rizal" />);
    expect(screen.queryByTestId("street-view-iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View surroundings" }));
    const frame = screen.getByTitle("Google Street View near Plaza Rizal");
    expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(screen.getByText(/signage and boarding location unverified/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close Street View" }));
    expect(screen.queryByTestId("street-view-iframe")).toBeNull();
  });
  it("offers a keyless external link when Embed is unconfigured", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY", "");
    render(<StopStreetView {...point} name="Plaza Rizal" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/not available in this version of the app/)).toBeTruthy();
    const url = new URL(screen.getByRole("link", { name: "Open Street View in Google Maps" }).getAttribute("href")!);
    expect(url.searchParams.get("viewpoint")).toBe("13.6233869,123.1846726");
    expect(url.searchParams.has("key")).toBe(false);
  });
  it("does not open the iframe offline and permits retry after reconnecting", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY", "test-embed-key");
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<StopStreetView {...point} name="Plaza Rizal" />);
    fireEvent.click(screen.getByRole("button", { name: "View surroundings" }));
    expect(screen.getByRole("status").textContent).toContain("Internet is required");
    expect(screen.queryByTestId("street-view-iframe")).toBeNull();
    online.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "View surroundings" }));
    expect(screen.getByTestId("street-view-iframe")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Street View in Google Maps" })).toBeTruthy();
  });
});

