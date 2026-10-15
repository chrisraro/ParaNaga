// @vitest-environment jsdom
// The endpoint channel of the /app frame: another screen asks the home screen to set an end of the
// trip (or to open "Choose on map"); the home screen applies each request once, through
// endpointsReducer. HomeScreen itself (Leaflet map, GPS) is replaced by a probe that consumes the
// channel exactly like it does (useApplyOnce + endpointsReducer).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useReducer, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAGA_DEFAULT_CENTER } from "@/domain/geo/naga";
import { endpointsReducer, initialEndpointsState } from "@/domain/trip/endpoints";
import { useAppFrame, useApplyOnce } from "@/ui/app-shell/app-frame-context";

const applied = vi.fn();

function HomeProbe() {
  const frame = useAppFrame();
  const [endpoints, dispatch] = useReducer(endpointsReducer, initialEndpointsState);
  const [, setTick] = useState(0);
  useApplyOnce(frame?.endpointRequest ?? null, (request) => {
    applied(request);
    if (request.kind === "pick") dispatch({ type: "pick", which: request.which });
    else dispatch({ type: "set", which: request.which, endpoint: { point: request.endpoint.point, source: "search", label: request.endpoint.label } });
  });
  return (
    <div>
      <p data-testid="start">{endpoints.start?.label ?? "none"}</p>
      <p data-testid="destination">{endpoints.destination ? `${endpoints.destination.label} (${endpoints.destination.source})` : "none"}</p>
      <p data-testid="picking">{endpoints.picking ?? "none"}</p>
      <p data-testid="error">{endpoints.error ?? "none"}</p>
      <button type="button" onClick={() => setTick((n) => n + 1)}>
        Re-render home
      </button>
    </div>
  );
}

vi.mock("@/ui/home/home-screen", () => ({ HomeScreen: () => <HomeProbe /> }));

// Imported after the mock is registered (vi.mock is hoisted).
const { AppFrame } = await import("@/ui/app-shell/app-frame");

const PLAZA = { lat: NAGA_DEFAULT_CENTER.lat + 0.004, lng: NAGA_DEFAULT_CENTER.lng + 0.004 };

function Requester() {
  const frame = useAppFrame()!;
  return (
    <>
      <button type="button" onClick={() => frame.requestEndpoint("destination", { point: PLAZA, label: "Plaza Rizal" })}>
        Go there
      </button>
      <button type="button" onClick={() => frame.requestEndpoint("start", { point: PLAZA, label: "Same spot" })}>
        Start there
      </button>
      <button type="button" onClick={() => frame.requestPick("start")}>
        Pick start
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  applied.mockReset();
});

describe("AppFrame endpoint channel", () => {
  it("applies a destination request once, as a search endpoint with its label", () => {
    const { rerender } = render(
      <AppFrame>
        <Requester />
      </AppFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go there" }));
    expect(screen.getByTestId("destination").textContent).toBe("Plaza Rizal (search)");
    expect(applied).toHaveBeenCalledTimes(1);

    // Re-renders (the home screen's own, and the frame's) never re-apply the same request.
    fireEvent.click(screen.getByRole("button", { name: "Re-render home" }));
    rerender(
      <AppFrame>
        <Requester />
      </AppFrame>,
    );
    expect(applied).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("destination").textContent).toBe("Plaza Rizal (search)");
  });

  it("goes through the reducer's rules: a start on top of the destination is refused", () => {
    render(
      <AppFrame>
        <Requester />
      </AppFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go there" }));
    fireEvent.click(screen.getByRole("button", { name: "Start there" }));
    expect(applied).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("start").textContent).toBe("none");
    expect(screen.getByTestId("error").textContent).toBe("same_place");
  });

  it("each new request applies, even when it repeats the previous one; a pick request opens the pick", () => {
    render(
      <AppFrame>
        <Requester />
      </AppFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick start" }));
    expect(screen.getByTestId("picking").textContent).toBe("start");
    fireEvent.click(screen.getByRole("button", { name: "Go there" }));
    fireEvent.click(screen.getByRole("button", { name: "Go there" }));
    expect(applied).toHaveBeenCalledTimes(3);
    expect(applied.mock.calls.map(([r]) => r.n)).toEqual([1, 2, 3]);
  });

  it("a home screen mounted after a request does not replay it", () => {
    function Late({ show }: { show: boolean }) {
      return show ? <HomeProbe /> : null;
    }
    const { rerender } = render(
      <AppFrame>
        <Requester />
        <Late show={false} />
      </AppFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go there" }));
    expect(applied).toHaveBeenCalledTimes(1);
    act(() => {
      rerender(
        <AppFrame>
          <Requester />
          <Late show />
        </AppFrame>,
      );
    });
    expect(applied).toHaveBeenCalledTimes(1);
  });
});
